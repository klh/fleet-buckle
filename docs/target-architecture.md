# Target architecture — buckle, the auth collapse, and the worker plane

Status: SUPERSEDED design history, 2026-11-16. The current rollout is
[`tasks/plan.md`](../tasks/plan.md), bounded by
[`tasks/implementation-contract.md`](../tasks/implementation-contract.md)
and this repository's AGENTS.md. The worker lift, Buckle model pins,
auth collapse, and knowledge integration below are historical proposals,
not implementation instructions. Existing code needs explicit migration
tasks; this document authorizes no new worker or supervisor code in Buckle.

## 1. Three planes

```
        ┌────────────────────────────────────────────────────┐
        │  ADDON PLANE — a SUPERVISOR durable job            │
        │  (src/agents/); does work itself OR spawns sessions│
        │  on per-task models (/w/<slug> lanes), sealed      │
        │  microworkers                                      │
        └───────────────┬────────────────────────────────────┘
                        │ model legs ride the openai wire (/w/<slug>)
                        ▼
        ┌────────────────────────────────────────────────────┐
        │  BUCKLE — 3 jobs + pass-through (FROZEN scope)     │
        │  1. multihop federation      2. access proxy       │
        │  3. dialect-aware context injection                │
        │  everything unhandled rides VERBATIM to the engine │
        └───────────────┬────────────────────────────────────┘
                        │ engine leg (openai wire + x-litellm-tags)
                        ▼
        ┌────────────────────────────────────────────────────┐
        │  LITELLM — identity truth + budgets + UI           │
        │  virtual keys; per-key spend; the vanilla UI       │
        └────────────────────────────────────────────────────┘
```

Each plane owns what only it can see. Buckle facts (lane, principal,
injection rule) exist ONLY at buckle; budgets and key identity exist
ONLY at litellm; agent state (issue threads, phase machines) exists
ONLY in the agent plane (the host's durable job storage). The hub's
Fleet knowledge base holds reusable, provenance-linked knowledge
across jobs; it is not the job's execution state. Cross-plane data
rides explicit contracts: the
`/w/<slug>` path, the `x-litellm-tags` header, the problem+json wire.

## 2. The auth collapse (b) — buckle auth is FROZEN, then shrinks

**Ruling**: buckle auth is frozen as-is. Nothing new lands in
`buckle.access.*`; the `lanes` table stays only until the collapse
lands. No grandfathering: the collapse DELETES buckle auth surface,
it never ports it.

1. **Pass-through auth (chat legs)**: callers hold litellm virtual
   keys. Buckle forwards `authorization` VERBATIM on engine legs and
   relays litellm's verdicts (401/403 ride back as-is). Buckle mints
   keys ONLY for: hop peering, admin faces, the spawn API.
2. **Facts from the engine**: principal/lane facts for events come
   from a short-TTL cache of litellm's `/key/info` (the key's
   metadata carries `principal`, `lane`, tags). Risk noted: cache TTL
   vs revoked keys — bounded by admission re-checks every TTL window.
3. **What stays at buckle (the load-bearing 40%)**: hop receipts +
   trace/deadline custody across hubs, the TS injection seam (facts
   exist only here), front-only faces (federated tree, stats, health),
   the lane pin lookup until litellm model-aliases can pin.

**Where `/w/<slug>` lands when the lanes table dies**: the slug as a
PATH survives the collapse forever — it is pure attribution. The PIN
migrates into litellm model-aliases (the alias IS the pin; buckle
then forwards a slug-bearing path to the aliased model). The one
piece that can NEVER leave buckle is the context-injection rule keyed
on the slug — lane facts exist only at buckle. So §3's agent plane
survives the collapse intact: same launch URLs, pins move one layer
down, injection stays.

litellm→litellm native chaining (openai-compat `api_base` legs) is
legal ONLY inside one trust domain (one host's swarm). Cross-hub
traffic is irreducibly buckle hops: key translation, per-hop
admission, and receipt custody do not exist in litellm.

## 3. The worker plane (c) — pi-durable agents on the tuned seed

**The tuned seed exists** (fleet repo; ~2 days and 100+ runs of config
search): `klh/pi-durable-seed@sha256:d8a9b563…` — manifest-bound
(`seed/manifest.json`: base-image digest, seed digest over the staged
file set, policy digest over the sandbox limits, SBOM) on the pinned
`@earendil-works/pi-durable@1.5.0` runtime, carrying the fleet's tuned
layer: wake tasks, budget guards, doom-loop ladder, uniform task tool,
announce/heartbeat. The seed image is already in the local daemon.

**The architecture inversion (my first cut got this wrong):** seed
containers run `--network none` — the model NEVER runs inside. The
HOST drives a durable conversation (fsync-JSONL storage, 0600
manifest, lease-fenced admission, model fetches gated through the
OpenAI-compatible route — which IS buckle) and dispatches tool calls
into the sealed container via `docker exec` (`desktop_sandbox_exec`).
The container is today's SANDBOX; thinking is host-side; durable state
lives in the host's private per-job storage. The host-to-sandbox contract
must also work when the sandbox is a microVM without `docker exec`, a
Docker socket, bind mounts, or a shared host filesystem.

**The lift (this wave, into `src/agents/` + a b3 host; kept in
fleet-buckle for now — no cross-package import):** the fleet glue
(≈4.8k lines: runners/durable 411 + runners/desktop ~2.4k +
pi-durable-workers src ~1.6k + seed build 363) becomes buckle-native
modules, one construction site per concern, buckle zod schemas
throughout:

| module (src/agents/)         | lifts from                            | what it owns                          |
| ---------------------------- | ------------------------------------- | ------------------------------------- |
| `buckle.agents.zod.ts` ✅    | durable/contracts.ts + seed-manifest  | the wire contracts                    |
| `buckle.agents.paths.ts` ✅  | durable/private-paths.ts              | private POSIX job storage + atomic    |
|                              |                                       | 0600 writes                           |
| `buckle.agents.writer.ts` ✅ | durable/host-writer.ts                | the host writer lock (SQLite tx)      |
| `buckle.agents.guard.ts` ✅  | execution-guard.ts + fenced-models.ts | registry pin + model/tool fencing     |
| `buckle.agents.job.ts`       | runners/durable/job.ts                | job storage, admission, resume, abort |
| `buckle.agents.lease.ts`     | lease/epoch fencing                   | the authorize closure                 |
| `buckle.agents.seed.ts` ✅   | src/seed-manifest.ts                  | canonical digests, manifest I/O       |
| `buckle.agents.launch.ts`    | desktop/docker-executor.ts            | digest-pinned launch args + child     |
|                              |                                       | cleanup (the docker backend of        |
|                              |                                       | §3's sandbox contract)                |
| `buckle.agents.exec.ts`      | dispatchTool                          | sandbox exec into containers          |
| `buckle.agents.wake.ts`      | pi-durable-workers/wake.ts            | wake policies (cron/poll/event),      |
|                              |                                       | riding `sleepUntil`/`onWake`          |
| `buckle.agents.tasks.ts`     | pi-durable-workers/tasks.ts           | the model-facing task tool            |
| `buckle.agents.announce.ts`  | announce/heartbeat                    | lane-visible presence                 |

(✅ = landed in tree; the rest land this wave. `seed.ts` is the
digest/manifest LIBRARY; `deploy/seed/` below is the BUILD that uses
it; `launch.ts` is the docker backend of §3's sandbox contract.)

This placement is deliberate for the current build and Calculon test.
The eventual home for the agent runtime, supervisor skills and catalog,
seed builds, sandbox backends, and remote job control is a separate
`ikea-flock-agents` project. Buckle will remain the model gateway and
federation boundary. Keep the agent-to-Buckle contract explicit now
(model route, identity, attribution, and errors) so the later move does
not require moving Buckle's proxy or auth logic with it.

**The seed BUILD pipeline lifts too** — fleet-buckle owns it as the
BASE supervisor seed (the proven W2958 build; structure kept
verbatim, only the payload source changes). Same discipline as the
src/agents table: one module per concern, everything digest-pinned:

| path (deploy/seed/)    | lifts from                | what it owns                                                  |
| ---------------------- | ------------------------- | ------------------------------------------------------------- |
| `build.ts`             | seed/build.ts (321)       | stage → resolve → digest → buildx → verify → smoke → manifest |
| `stage.ts`             | seed/stage.ts (42)        | exact payload staging (src/agents + readiness + policy)       |
| `payload/Dockerfile`   | seed/payload/Dockerfile   | oven/bun base + payload at the pinned path                    |
| `payload/policy.json`  | seed/payload/policy.json  | the sandbox limits the smoke test enforces                    |
| `payload/readiness.ts` | seed/payload/readiness.ts | the PI_DURABLE_SEED_READY marker probe                        |
| `variants/<name>/`     | — (new)                   | addendum layers (tool packs, extra images, config) building   |
|                        |                           | FROM the pinned base; each variant's manifest chains to it    |
| `manifest.json`        | seed/manifest.json        | BUILT ARTIFACT (committed): digests, SBOM, deps, source rev   |

`package.json` gains `"seed:build": "bun run deploy/seed/build.ts"`.
Build steps are the fleet's, unchanged: stage OUTSIDE the repo (bun
lockfile isolation — a stage under the repo would write its lockfile
to the root and leave the build context without one), host dep
resolve with `--ignore-scripts` (lockfile frozen; node_modules is
EXCLUDED from the digest — the lockfile + dep pins carry it),
`docker buildx --platform linux/amd64 --load`, digest-pin resolve
check (the exact `name@sha256:` ref the runner references), smoke
under the executor's EXACT isolation (read-only rootfs, cap-drop
ALL, no-new-privileges, 1000:1000, network none, noexec tmpfs /tmp +
/workspace) — non-root boot, overlay check, readiness marker, git
present — then the 0600 atomic manifest write with `source.dirty`
EXCLUDING the manifest itself (a build must not make itself dirty
forever). Also lifted verbatim: `src/seed-readiness.ts` (137) — the
readiness probe the smoke runs in-image.

The seed digest authenticates the payload bytes; it does not by itself
grant or enforce a capability. The manifest declares a capability
ceiling, and admission binds that declaration to the pinned seed and
the host's repository policy. Every model, tool, GitHub, and sandbox
effect must be checked at its host boundary against that binding.

**Seed base and variants**: the seed is a BASE plus VARIANTS. The
base is the per-backend root — the docker image today, a microVM
base image later — carrying the runtime payload, policy, and
readiness exactly as the proven build stages them. A VARIANT is
the pinned base plus an ADDENDUM: added CLI tool packs, extra
declared images for spawned work, config overlays. Each variant
builds FROM the base's exact digest, chains its provenance (the
variant's manifest extends the same contract with
`base{digest,manifest}`; the variant digest binds the base digest
plus the addendum bytes), and its SBOM is the base's rows plus the
addendum's. Addenda are additive and policy-monotone: a variant may
tighten the base policy, never widen it — the guard rejects a
widening addendum. A variant's `SeedCapabilitiesSchema` rows are
the base's union the addendum's, so a variant is a new capability
ceiling, a new seat generation, a new lane — a clean attribution
epoch — while the base stays pinned and shared.

**CLI tool packs (`gh`, `az`, …)** are the first addendum kind:
host-facing CLIs the variant build installs, each named in the
addendum's tools rows, bytes pinned in its SBOM. A seat pinned to
a variant carries them; a seat on the base does not (`command not
found`). Credentials NEVER ride any image: a seat gets per-lane
mounts at launch (config-over-code — lane settings → launch env:
`GH_TOKEN` + `GH_HOST` for gh, service-principal credentials for
az, `AWS_*` for aws), minted per lane, 0600 on the host, read-only
inside the sandbox, revocable. Interactive logins (`gh auth login`,
`az login` device/browser flows) are banned in-agent: an agent's
credentials are non-interactive service credentials. The declared
toolset is prompt-visible (the supervisor skill lists what the seat
carries), and the machine-checked declaration is its mirror.
Failure shape is part of the contract: a tool whose credential is
not mounted fails loud with the CLI's own auth error (asserted
content, §5.8), and a tool the seat does not carry is
`command not found`. The hermetic cycle keeps the worker's REST
client (gh requires https for custom hosts — the stub world does
not speak it); the seam is proven by cheaper specs: the binary
present at the pinned variant digest, its version recorded in the
SBOM, and the denial content above.

**Mechanical output quality (`qlty`)**: the BASE seed carries qlty
(declared tool, SBOM-pinned) — output consistency is enforced
mechanically, never left to model discretion. The gate runs at two
seams. ON WRITE: the `write`/`edit` tools are wrapped, and each
touched file passes the quality gate before its tool result
returns (biome owns code formatting, prettier owns markdown — the
fleet law). AFTER A RUN: an `afterRun` gate runs the full check
suite over the workspace diff; a failure comes back as diagnostics
with relevant content (rule id + location) and feeds a capped fix
run — never a silent pass. Config-over-code: the gate reads the
TARGET repo's `.qlty/` when present; a code-tending seat whose repo
carries none gets the seed's pinned fallback config, declared as
data — the gate never silently no-ops. SPEC FIRST rides the skill:
read `.qlty/qlty.toml` and the biome rule set before the first
write. Security scanning is the same seam: qlty's security plugins
run in both gates, so flagged patterns are denied mechanically,
not by prompt.

`deploy/worker/` becomes the HOST service on b3: the GitHub wake
(webhook event → a verified wake face; the REST poll rides as the
backstop), the durable job turns, model legs fenced through the b3
lane pin for the first test instance, sandbox exec, and the PR flow.
Later repositories get their own configured route. The wake seam
rides pi-durable's native primitives: the harness owns when a
session needs a process (`wake()` → `active`/`at`, reported through
the `onWake` host callback), tasks sleep durably (`sleepUntil` — the
poll backstop is a sleeping task whose deadline surfaces in `at`),
and the GitHub wake face only submits and resumes — no host-side
timer loop, no hand-rolled interrupt flag.

**Lane naming — the path names the SEAT and WHERE it lives**: one
agent seat = one sandbox (seed container now, microVM later) + one
lane (its model seam) + one hub (the deployment that owns the
sandbox). The launch path is `/w/<hub>/<seat>` where the SEAT slug
is `<role>-v<generation>-<repo>` — the first instance rides
`/w/b3/repoagent-v1-calculon` (real hubs: `/w/nas/…`,
`/w/desktop/…`). The hub is a PATH SEGMENT, not a dash-join: the hub
is where the seat lives, not part of its name — dash-joins are
unparseable once hub names contain dashes, "all seats on hub b3"
becomes a path-prefix query, and the same seam can later carry
cross-hub routing (any buckle asked for `/w/<hub>/<seat>` it does
not own hops it — gated per §5.11). Attribution aggregates fleet-wide (board, spend
per key, litellm tags), so the full path must be unique across the
fleet. Semantics: a WRONG hub segment fails loud (404 — this
deployment is not that hub; a misroute is a config error, never
silent); an unknown SEAT on the right hub keeps W1 attribution-only
riding. Versioning the seat slug means a new seed generation = a new
lane = a clean attribution epoch. A repo is never a seat by itself —
it cannot tell a feature agent from a bug agent, nor v1 from v2.

Migration order (the route parses ONE segment today): (1) `lane.ts`
learns `/w/<hub>/<seat>` + settings carry the deployment's hub
label, wrong-hub → 404, single-segment paths stay valid (seat on the
local hub); (2) then the lane rows, compose env, and worker defaults
rename to the two-segment form. The tree currently holds the
dash-joined `b3-repoagent-v1-calculon` (one segment — routes fine,
naming only) and moves at step 2.

The seed manifest contract (schema_version 1:
source{revision,dirty,package}, base_image, runtime_image, platform,
seed{digest,files,bytes}, policy{digest,user,memory_mb,cpus,
pids_limit,work_mb,tmp_mb}, deps, readiness{command,marker},
sbom[{path,sha256,bytes}], built_at) is lifted verbatim into
`buckle.agents.zod.ts` — one schema, used by build, admit, and the
executor alike.

**The calculon flow, recast v2** — the always-on thing is a
SUPERVISOR (a durable job whose brief IS the supervision policy):

1. wake fires on the GitHub repo (webhook event → the wake face; the
   REST poll is the backstop) → submission joins the supervisor's
   brief-driven loop (`followUp` when busy, start idle)
2. classify (bug / feature / other); feature → clarify with the
   writer (comments out, answers back in on later wakes)
3. writer explicitly authorizes implementation ("implement") → the
   supervisor DECIDES per task: do it itself, or spawn session(s) —
   possibly on DIFFERENT models (each child generation carries its
   own provider/model = a
   /w/<slug> lane pin) — in microworker sandbox containers. The
   default is single-lane: minor tasks ride the supervisor's own
   conversation — one focused lane routinely beats a multi-agent
   fleet on minor work — so spawning is what the brief calls for,
   never a reflex.
4. implementation lands on branch `agent/issue-N`; a microworker
   builds the site, the HOST deploys the preview to surge.sh
   (`https://klh-calculon-issue-<N>.surge.sh`; §5.6, decided)
5. the supervisor comments BOTH links and the preview deployment receipt
   (source commit SHA and artifact digest):
   "preview here, PR here — approve deployment receipt <id> for this PR"
   (PR carries `Closes #N`)
6. an authorized repository maintainer explicitly approves that
   deployment receipt and PR for merge → supervisor merges the PR to
   main, bumps the version (pyproject/CHANGELOG), the main Pages site
   updates, and the host TEARS DOWN the surge preview
   (`surge teardown` on merge, issue close, or supersede)

Concurrency and idempotency: the supervisor's OWN loop is serial —
one conversation, wake submissions arrive as `followUp` when busy.
Parallelism exists only as spawned child sessions or child tasks,
bounded by the seed's spawn budget. Parallel requests take one of two
durable-conversation shapes, each with its own lane pin: a CLONE — the
supervisor forks itself (`fork(at)`: agent + transcript as of the
fork point; full context, divergent from there) when a task needs
the whole thread; or a NEW WORKER — a fresh task-owned conversation
(persona copied, context empty) handed only a brief; the tool call
IS the telling. A third axis is NOT a conversation: multi-step work
WITHIN one lane (implement → preview → PR) rides CHILD TASKS —
durable task children the issue-task commits a `waiting` state on
(`failFast` aborts the remaining steps on the first failure; the
parent holds its outcome as `completing` until they drain; abort
runs bottom-up, so each step undoes its own effects). The preview
and acceptance checks after an implementing run are the native
`afterRun` shape: durable tasks started once a run answers,
resumed across crashes, feeding a fix run back as a follow-up
input when they fail. The choice is the supervisor's, per its brief —
the inbox itself stays serial (`followUp`); nothing downstream of
a wake ever fans out on its own. Idle cost is zero: the supervisor sleeps until a
verified wake — events carry latency, the poll backstop reconciles
dropped ones, and the boot sweep heals everything missed while down.
The wake→submission seam is where crash-safety
is won: the HOST derives each submission's `requestId` from the
GitHub event id, so redelivery after a crash recovers the original
turn instead of duplicating it (§5.3's proof obligation).

The supervisor pattern generalizes: one always-on durable job, a
brief that encodes WHEN to do work itself vs spawn (clone with
context, or brief-only new worker), child
generations on per-task models (bounded sandboxes), checks and merges
owned host-side. Docker containers are the first backend. A
Firecracker-style microVM on a KVM-capable Linux hub is the intended
next backend; a Mac needs a separate Virtualization.framework adapter.
Neither changes durable conversation storage or the supervisor's model
route.

**Promote an ordinary session to a remote durable job**: a user may
begin with a normal interactive LLM session through Buckle, work out
an idea, and later request that it keep running remotely. The handoff
first asks which versioned **supervisor skill** should take the context:
choose a premade skill, adapt one into a new version, or create one.
The skill defines the brief, decision rules, wake behavior, required
tools, review points, and completion criteria. The seed is the separate
runtime artifact; making a skill normally does not require rebuilding
it. If a skill requires capabilities beyond the seed's declared
ceiling, authoring must request a reviewed new seed instead of widening
a running job. See [Supervisor skills and session handoff](supervisor-skills.md).

Buckle is the model gateway, not the owner of the complete conversation
or local tool state. Promotion therefore starts from an explicit, bounded
session export by the client (or an opt-in capture made for this
purpose), with a checkpoint of the conversation, source references,
and outstanding work. Local shell state, credentials, and unverified
tool results do not become remote capabilities by being in that export.

After skill selection, setup asks what this job should do, which hub
should run it, what should wake it (schedule, event, or both),
which repositories or other resources it may touch, what effects it
may perform without asking, its model and spend limits, and when it
should stop or ask for review. The user sees the resulting brief and
policy, then explicitly enables a new durable job generation. The
host validates the checkpoint and policy, binds their digests to the
owner, skill content digest, and seed/backend digests, and records an idempotent
handoff before starting the remote runner. It must not silently turn an
ordinary chat into a
continuously running agent. Once enabled, the job has visible status,
history, budget use, and pause/resume/stop controls; later changes to
its authority require a new generation. The Calculon bugfixer is one
configuration of this promotion path, not a requirement that every
promoted session become a GitHub worker.

**Control vs capability**: wake submissions, steer, messages,
boards, and skill text are control inputs; none can grant a new right. The pinned seed
declares the available tool and wake ceiling, while host policy grants
the repository, model route, GitHub effects, sandbox limits, and
budgets for that job generation. Admission verifies both digests and
the repository policy binding. Effective capability is the
intersection of seed-declared, runtime-offered, and host-authorized
rights, checked again at each effect boundary. A weaker seed or a
stricter host grant cannot be widened by a controller.

**Microworkers**: the seed container has NO docker socket and no
network (by design). Microworkers spawn HOST-side — the task tool's
child generations ARE the microworkers: additional digest-pinned
containers, one bounded argv each (`spawn`/`check`/`steer`/`cancel`),
resource-bounded by the same policy digest machinery. LLM-generated
code may run inside the sandbox; it must never execute on the host.
The host supplies policy-checked argv and file bytes, not a shell
command composed from a model reply.

**Sandbox backend contract (design now for microVMs)**: the host owns
`launch`, `execute`, bounded input/output transfer, `cancel`, and
`destroy` behind one interface. Docker uses its executor today. A
microVM backend boots a digest-pinned guest image with a minimal guest
executor and exchanges framed requests, results, and files over a
host-controlled channel such as vsock. It never relies on `docker
exec` or host paths being visible in the guest. Requests name an
allowed program, bounded argv and input, a deadline, and output
limits. The guest has no GitHub credential or direct model route.

The OCI seed digest identifies the Docker artifact. A VM build must
separately pin the guest rootfs, boot component, executor, and policy;
an OCI image digest alone does not identify a bootable VM (a VM
build's extra pins ride a manifest EXTENSION — schema_version 1 pins
the OCI shape and stays the Docker contract). The VM
adapter must enforce the same effective limits: no network interface
by default, immutable base image, bounded writable scratch, resource
limits, and forced teardown on timeout or lease loss. Source and
dependency input, plus diff/log/preview output, cross the bounded
transfer interface rather than bind mounts. Backend parity tests must
prove capability denial, crash cleanup, and artifact validation before
a VM backend replaces Docker. Firecracker requires a suitable Linux/KVM
host; check that prerequisite instead of assuming b3 or the NAS has it.

**Source and artifact handoff**: the host fetches an authorized commit
and stages an isolated repository workspace for the child; the child
receives no GitHub credential or host Docker socket. The sandbox runs
the repository's declared checks and returns a bounded diff, logs,
and preview artifacts. Before publishing effects, the host validates
paths, symlinks, output size, base commit, and the repository binding.
The networkless and `noexec` mount rules need a tested dependency and
test-execution path for each repository; they cannot silently prevent
the general agent from running the code it is meant to verify.

**Agent role**: a general GitHub bug fixer and feature implementer.
Its durable supervisor watches assigned repositories for bug reports
and feature requests, clarifies requirements with their authors,
implements changes, tests them, and presents a branch, preview, and
PR for review. Calculon is a test configuration of this role, not a
Calculon-specific agent implementation.

**First test instance**: monitor only `icomdev/calculon` (fork of
sprytnyk/calculon; Pages currently serves `docs/` from main at
https://icomdev.github.io/calculon/). A later instance may monitor
several repositories, with separate permissions, wake cursors,
budgets, and effects for each repository.

**Repository contract (generalization gate)**: each assignment needs
an immutable repository identity and a versioned policy for event
sources, branch and PR rights, test/build commands, preview provider,
versioning, and who may approve each effect. Calculon's Pages path,
`pyproject`/CHANGELOG bump, and issue-comment phrases are values of
that first contract, not behavior baked into the general agent. Host
GitHub operations and container mounts must use the assignment's
repository-scoped credential and workspace; a model response or
external steer cannot switch either. A later multi-repository instance
must preserve a separate wake cursor, job generation, budget, effects
ledger, and knowledge namespace for each assignment.

**Per-repository adaptation (later)**: tune the supervisor's brief,
model choices, wake policy, and tools for repositories it owns. A
capability change creates a new digest-pinned seed or job generation;
it never widens a running job in place. An optional idle "dream"
cycle can inspect commit history, issue and PR comments, and build or
runtime logs to propose useful fixes and features. Any resulting
implementation follows the same repository permissions, sandbox,
preview, and review path as an issue-triggered task.
An idea discovered without an issue author can become a proposal or
draft PR, but only a repository maintainer can approve its merge.

**Hub Fleet knowledge base**: each durable supervisor reads the
knowledge base on its assigned hub before planning work, and updates
it after a verified outcome. Entries are scoped to the repository
and include source links or commit IDs, observed behavior, decisions,
failed approaches, and reusable lessons. The supervisor can use this
history during idle dream cycles to avoid repeating work and to find
candidate improvements. Knowledge writes are deduplicated and
scrubbed of secrets; a knowledge entry never grants a tool, changes a
seed capability, or substitutes for the job's durable state. When an
instance owns several repositories, it keeps their knowledge and
authorization scopes distinct. This is a target contract; the hub
read/write integration and its tests are still to be built here.

**Later (not this wave)**: the addon as a SERVICE — VM quotas, spawn
admission, per-agent key minting, fan-out trees on Firecracker-style
microVMs where Linux/KVM is available (with a separate
Virtualization.framework adapter on the Mac). litellm budgets tokens;
it never budgets VMs or spawns.

## 4. Not ported from the old buckle (the frozen 171-entry map)

Pinned by `buckle-source-map.json` (171/171 ingested, map frozen).
Everything in the old `packages/buckle/src/` that the 3-jobs ruling
did NOT claim is deliberately not ported. Highlights, by disposition:

| old buckle                                                      | disposition                                |
| --------------------------------------------------------------- | ------------------------------------------ |
| adapters/ (anthropic, vertex, bedrock, azure, responses, tools) | litellm owns provider adapters             |
| router*, candidates, cooldown, resilience*, affinity            | litellm router + budgets own routing       |
| budgets, cost, usage, ledger*                                   | litellm spend tracking (per-key)           |
| gov/ keys, jwt, oidc, mcp-scopes                                | replaced by virtual keys (pass-through)    |
| eval/ (tasks, graders, hillclimb)                               | separate benchmark concern (blam)          |
| sse*, stream-*, proxy-stream                                    | engine-leg streaming, verbatim             |
| lane-wrap, copilot-*, chatgpt-bridge, systemone                 | old-hub specific wiring                    |
| context-inject                                                  | PORTED (rewritten dialect-aware at buckle) |
| hop, federation                                                 | PORTED (hops + receipts)                   |
| admission (scopes/keys)                                         | PORTED as buckle.access (FROZEN)           |

The full per-file map lives in `buckle-source-map.json`; this table
is the human-readable summary. A row can move to PORTED only with its
replacement shown side-by-side.

## 5. Review findings (2026-11-14) and their disposition

Findings from the review, dispositioned against the §3 lift. The
behavior above is the target; each OPEN row needs a test and a
deployment receipt before the claim can be treated as landed.

1. **[OPEN] Auth collapse is still planned.** The engine and
   catch-all proxy paths replace the caller's `authorization` with
   the buckle engine token (`src/proxy/buckle.proxy.engine.ts`,
   `src/proxy/buckle.proxy.passthrough.ts`). Prove virtual-key
   forwarding, unchanged 401/403 relays, and separate
   hop/admin/spawn credentials before retiring buckle admission.
   `x-litellm-tags` is attribution, not authority — agreed, stated.
2. **[DISPOSITIONED] Unknown launch slugs.** The ruling is W1
   semantics: ANY slug rides (pure attribution — a lane name is not a
   capability); a slug with a row pins. A typo'd launch URL rides
   unpinned BUT visibly: the response echoes `x-buckle-route`, so a
   wrong slug is observable, never silent. Still owed: the test
   proving a pin does not widen the caller's principal-scoped
   federated catalog.
3. **[DESIGN ADDRESSES; PROOF OPEN] Crash-safety.** The hand-rolled
   `worker.json` state machine remains in `deploy/worker`. The lift
   intends to replace it with durable job storage (fsync JSONL, 0600
   manifest, repeated request-IDs recovering the original submission).
   The host must also reconcile GitHub comments, branches, and PRs on
   retry; prove both layers with crash-injection tests.
4. **[DESIGN ADDRESSES; PROOF OPEN] Docker socket = host control.**
   The current `deploy/worker` container still mounts the host socket.
   The replacement must spawn host-side through digest-pinned launch
   args (read-only rootfs, cap-drop ALL, no-new-privileges, network
   none, memory/cpu/pids limits, uid 1000:1000), refuse weaker
   sandboxes with `canonicalPolicyDigest`, and force-remove children
   on timeout. Prove those properties before removing the old worker.
5. **[OPEN] GitHub token provisioning.** Compose expects
   `test/deploy/keys/.gen/worker.github.token`; the mint step (a bun
   entry reading `gh auth token`, 0600, gitignored) must land with
   the host service so deployment is repeatable, or the docs must
   carry the manual step.
6. **[DECIDED 2026-11-14; PROOF OPEN] Preview hosting = surge.sh,
   deleted afterwards.** DECIDED: previews deploy to surge.sh, one
   subdomain per issue — `https://klh-calculon-issue-<N>.surge.sh`,
   via `npx surge <dir> <domain>` run from the HOST (sandboxes are
   network-none; publishing is a host effect, validated per the
   artifact-handoff rules) — and are TORN DOWN after merge, issue
   close, or supersede via `surge teardown <domain>`; nothing
   persists. The surge URL is a convenience view, never the artifact
   of record — approval binds to the deployment receipt, source commit,
   artifact digest, and PR (§5.7 and §5.12), because a subdomain
   redeploy overwrites. Credentials:
   `SURGE_LOGIN` + `SURGE_TOKEN` ride the same 0600 env-mint pattern
   as the GitHub token (§5.5). Rejected: a dedicated Pages previews
   repo (ceremony, a second git surface) and Actions-source compose
   publishing on the main site (workflow blast radius on the
   production Pages). Caveat: surge subdomains are a GLOBAL
   namespace — the `klh-calculon-` prefix claims ours; first deploy
   wins. Proof owed: one end-to-end deploy + teardown receipt with
   the live URL in the issue comment, then the branch-preview flow
   may claim URLs.
7. **[OPEN] Merge approval needs provenance.** The current worker
   accepts an approval word from any non-bot comment. The new
   supervisor proposal still allows the issue author to approve a
   merge, although an issue author may have no repository write rights.
   Require a maintainer authorized by the repository policy to approve
   the exact preview commit and PR; an issue author can confirm the
   requested behavior. Ignore stale approval from an earlier commit or
   implementation phase. Test unauthorized, stale, and replayed
   comments before enabling merge.
8. **[OPEN] Seed capability and model-route enforcement.** The new
   `SeedCapabilitiesSchema` declares tools, faces, wakes, and budgets,
   but the manifest still makes that declaration optional. The current
   guard installs every runtime extension and checks
   only a generic `execute` authorization. Its model check allows any
   `openai-completions` endpoint; it does not yet pin the destination
   to Buckle's `/w/<slug>` route. Enforce the declared intersection
   and destination at each tool and model boundary, with denial tests
   for an undeclared tool, an alternate URL, and a widened controller.
9. **[OPEN] Hub knowledge integration.** The worker and agent modules
   do not yet read or write the Fleet knowledge base on their hub.
   Define a hub-scoped client, repository identity and provenance in
   the record schema, and idempotent writes after verified outcomes.
   Test recall before planning, cross-repository isolation, retry
   deduplication, and secret scrubbing. Idle dream cycles should use
   the same scoped recall and record candidate ideas separately from
   verified facts.
10. **[OPEN] Repository assignment is not an admission boundary.**
    `AgentJobSpecSchema` has no repository identity or policy digest;
    the current worker is hardcoded to Calculon. The general agent
    needs a versioned repository contract bound to each job generation
    and checked by the host at GitHub, workspace, preview, and merge
    effects. Prove that a prompt, wake, child session, or steer cannot
    cross from one assigned repository to another, and that an idle
    idea with no issue author cannot self-approve a merge.
11. **[OPEN] Hub segment changes the route trust boundary.** §2 calls
    `/w/<slug>` pure attribution, but §3 proposes `/w/<hub>/<seat>` as
    a future cross-hub route. The seat label may remain attribution;
    the hub segment selects a destination and therefore needs explicit
    caller authorization, a known-hub allowlist, hop limits, and tests
    for wrong-hub and forged-hub paths before forwarding is enabled.
12. **[OPEN] Mutable preview is not proof of what was approved.** A
    surge.sh subdomain can be overwritten after a reviewer opens it.
    Record a deployment receipt linking repository, PR, source commit,
    built artifact digest, deployment generation, and URL. Approval
    refers to that receipt; a redeploy or new PR commit invalidates it.
    Prove the served preview matches the receipt before merge, and test
    redeploy and teardown races.
13. **[OPEN] Interactive handoff has no immutable job receipt.** A
    version label does not identify skill content, and Buckle cannot
    reconstruct every client's local conversation or tool state. The
    exporting client must define a checkpoint and redaction contract.
    Bind its digest, the skill content digest, owner, assignment policy,
    hub, and seed/backend digests into one immutable job generation.
    Test duplicate handoff requests, partial exports, secret-bearing
    context, and a changed skill version before remote activation.
14. **[OPEN] Seat and sandbox lifetimes disagree.** §3 says one seat
    equals one sandbox and lane, while one persistent supervisor can
    spawn multiple child generations on different models. Specify the
    identity and lane of each child, whether its container or VM lives
    across turns or is recreated, and which durable state survives
    teardown. Test concurrent children, restarts, and attribution after
    a child sandbox is replaced.
15. **[OPEN] Temporary Buckle placement needs an extraction boundary.**
    The lift calls the agent modules buckle-native, but their eventual
    home is `ikea-flock-agents`. Keep durable storage, skill catalog,
    seed/build, sandbox, wake, and job-control dependencies inside the
    agent boundary. Define the versioned model-route and identity wire
    contract to Buckle now; test it through that boundary so extraction
    does not require moving Buckle proxy or auth internals.
16. **[OPEN] Calculon has no end-to-end acceptance receipt.** The
    current `deploy/worker` is webhook-woken with a REST poll backstop,
    uses a mutable JSON state file
    and the Docker socket, runs file syntax checks, and opens a PR.
    Before declaring the new test instance ready, prove issue wake →
    clarification → authorized implementation → repository checks →
    PR and preview → maintainer approval of the exact deployment
    receipt → merge/version bump → preview teardown → hub knowledge
    write. Inject a crash after each external effect and show that a
    retry does not duplicate comments, branches, PRs, previews, or
    merges. No worker-specific end-to-end test currently covers this.
17. **[OPEN] Promotion scope needs proof obligations.** The promotion
    path must never silently turn a chat into a running agent: prove
    no-promotion-without-explicit-enable, idempotent handoff
    (duplicate requests recover the same generation), and that any
    authority change forces a new job generation (a widened
    controller or skill edit cannot widen a live job).
