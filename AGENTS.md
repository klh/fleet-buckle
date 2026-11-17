# @fleet/buckle — the laws

The house TypeScript PaaS engineering standard applies here as one standalone
deployable repository. Carry its native-first, schema-first, small-module,
stateless-leaf, semantic-error, HTTP, exact-dependency, off-repo-config,
Playwright-project, and enforced-law principles into this repo. Its workspace
tree, shared package version, internal `@paas/*` packages, and monorepo
cross-import rules are examples, not instructions to recreate a monorepo.
Every new rule needs a check or a tracked migration gap.

## Owner plan file (tasks/plan.md)

Read `tasks/plan.md` at the start of every session. Its binding
vocabulary, task dependencies and Pi Durable source map govern the work.
Edit the plan when the owner directs it; otherwise propose changes with
evidence before changing binding architecture.

## Standalone repository boundary

Read `tasks/implementation-contract.md` before rollout edits. Each lane
owns one repository and an explicit file allowlist. This repository's
config, schema, dependency, test and code-shape laws govern Buckle; do
not import the fleet monorepo's package layout or governance runtime.
No source copies or filesystem imports from fleet/sibling checkouts.
Published standalone dependencies and HTTP/image contracts are the seams.
Existing agent/worker code is extraction debt, not permission to grow it.
Browser login/token caches belong to local client tooling; scheduling,
Pi runtime, seeds and microVMs belong to their worker/control owners.
Owner-approved pilot exception: a Node/Bun login script may live in
`test/manual/entra-login/` with its own dependency package. It opens
Entra browser login, obtains an API access token and launches the CLI
using private temporary settings; rerun on expiry is sufficient for
the owner pilot. It adds no imports or dependencies to Buckle runtime.
`docs/target-architecture.md` is superseded and grants no implementation
scope. Propose a bounded migration for existing code; preserve unrelated
work and do not relax laws or tests to make a change pass.

## Azure VMSS work placement after `/clear`

Read [`../fleet-worker/docs/vmss-work-intake.md`](../fleet-worker/docs/vmss-work-intake.md)
before launching Azure work. The observed scale set is `vmss-fleet-buckle`
in `RG-FLEET-BUCKLE-TEST`; rediscover the instance and image before acting.
The current Supervisor has authenticated `POST /tasks` for direct ad hoc
intake without a GitHub issue, then spawns worker-role children locally.
Its auth is `Authorization: Bearer`, not a Buckle key or the older
`x-supervisor-token` examples. The recovery rig is a test repository.
Buckle `:4111` is the model gateway through LiteLLM, never the task or
runner launcher. SSH is for deployment and inspection, not per-task work.
The target is a Pi Durable supervisor runner inside a Gondolin guest.
Its reviewed adapter pulls eligible external work items from Absurd/Postgres;
Worker hosts pull finite placement, wake and recovery operations. Worker
exposes Pi command/read primitives;
the separate GUI API owns browser SSE and presentation. The GUI API
authenticates people and transports that control path; charters use Git PRs for revision review, not dispatch.

## What buckle IS (the MITM law)

buckle is a **man-in-the-middle interface** for LLM traffic: fiddling,
exposure, key management, tracking, and context injection. Everything
forwards to the engine (litellm) untouched. The ONLY things buckle does
in-loop:

1. **Context injection** — inspect and modify messages to add context
   (a policy, for instance) per `context_policy` in settings.
2. **Key management** — keys in, per-provider keys out. Minted, never
   typed. Revocable, audited.
3. **Tracking + live overview** — who is connected, where work is taking
   place, tok/s per model/provider/buckle.
4. **Federation** — downstream peers' catalogs merged with per-hop
   access grants.

Never reimplement engine faces. Never add a "smart" feature that the
engine already has. The Azure rollout contract is one APIM-fronted,
Entra/AD-identified developer endpoint, a live federated model catalog,
context injection with policy-bearing items, and access to LiteLLM's supported
capabilities. LiteLLM owns model deployments, aliases, balancing,
fallback, and user-specific controls. APIM validates access and forwards
the user token and verified identity. Buckle maps that identity for
federation, context, and logs; prefer native LiteLLM user mapping when
the deployed version and license support it. Buckle does not hardcode
model lists or pin a model for the rollout.

MS Copilot is personal BYOC: each user's client supplies that user's
GitHub PAT per request, in the URL lane or a Bearer header according to
the client. If Bearer carries the PAT, APIM validates the Entra token
from a separate header, strips spoofable identity assertions, and
forwards the verified identity and original user token. Buckle and
LiteLLM relay the human PAT transiently; human BYOC has no shared engine
PAT. The isolated owner-worker pilot may mount the owner's PAT only at
its dedicated LiteLLM engine, with an engine key at Buckle. Human BYOC
must never fall back to that credential. Record the worker auth mode and
owner identity with distinct Fleet run IDs. Separate worker identities and seat tokens
are a later rollout step. Keep the Entra identity, Buckle admission
credential, and upstream PAT distinct. The rollout sequence and live
acceptance gates are in `tasks/plan.md`; read it before Azure, worker,
or federation work.

Developer CLI target: an unmodified Claude Code can point
`ANTHROPIC_BASE_URL` at the APIM Buckle URL through its user settings
JSON. For Copilot BYOC, a Bearer PAT uses `ANTHROPIC_AUTH_TOKEN` with
the separate Entra token in `ANTHROPIC_CUSTOM_HEADERS`. A URL PAT uses
`/w/<lane>/<PAT>` with the Entra token in `ANTHROPIC_AUTH_TOKEN`.
Preserve the Anthropic Messages, streaming, tools, and `/v1/models`
gateway faces through LiteLLM.
Prove this with the real CLI; a future local Fleet helper can acquire
and refresh tokens and install the settings. APIM 401/login recovery
must use a mechanical local command: silent Entra cache first,
system-browser sign-in or device code fallback, then a safe preflight.
No LLM session is required to authenticate. Keep a PAT out of
non-Copilot upstream requests. LiteLLM owns the translation between
Claude Code's Anthropic Messages API and GLM or other provider APIs.
Buckle preserves that capability through federation and context
injection. Live CLI tests verify our deployed chain; Anthropic's vendor
support policy is not an architecture gate.

## Port doctrine (the anti-mess ratchet)

The old monorepo buckle is 171 files; only ~22 were the proxy — the
rest was org-plane (routing ladders, dialect adapters, admin APIs,
eval harnesses). THIS repo stays small by rule: a port candidate must
serve one of the four in-loop things or the forwarding substrate, and
it lands as a REWRITE in this repo's patterns (zod-first, JSON5
settings, secrets-as-paths, problem+json, honest unknowns, kit-tested,
Docker-proven) — never a copy. If the engine, a sidecar, or operator
config can do it, it is DENIED here.

**Accepted ports** (each lands as its own commit with tests):

1. **Streaming pass-through** (from `proxy-stream`/`sse*` intent) — the
   forwarding substrate. Verbatim pipe upstream→client; NO reframing,
   NO injected bytes (byte-identity outranks heartbeats); settle at the
   real end; client-abort settles `abandoned`. New
   `buckle.server.stream.ts`.
2. **Durable usage ledger** (from `ledger`/`usage-record` intent) —
   in-loop thing 3. One SQLite table, ONE row written at settle (a
   crash undercounts, never writes a wrong row); tokens NULL = unknown
   (never 0-faked); bounded read face. New `buckle.server.ledger.ts` +
   `buckle.ledger.zod.ts`.
3. **Cost stamping** (the `cost.ts` LAW only) — versioned operator
   price table in settings; undeclared model = NULL cost, a declared
   $0 is a real zero; stamped at settle, never repriced.
4. **Scrub guard** (from the scrub rules) — every problem `detail`
   passes `scrubDetail()`: key/token shapes and `/Users/<name>` paths
   never ride errors. Mandatory because hop outcomes relay peer text.
5. **Hop deadline propagation** (from `hop-deadline` intent) — the
   remaining budget rides `x-fleet-buckle-deadline-ms`; each hop clamps
   its timeout to it and refuses at zero. Bounded chains by construction.
6. **Drain honesty** (the `drain.ts` LAW, minimized) — rides with
   streaming: on shutdown, in-flight streams settle `abandoned`; no
   invented terminals. Rolling/front owns deploys — no restart theater.

**Denied** (do not iterate these back in): dialect adapters +
count-tokens estimates (engine faces); router ladder, affinity,
cooldown, hints, complexity (engine owns failover); governance admin
API / HTTP key minting (static JSON5 grants + the on-machine mint
tool); aids/pipeline machinery (context injection lands as NEW code
per `docs/context_injection.md`); eval harness (blam's job); OTLP
export + dashboards/read-models (`/v1/stats`, `/v1/tree`, `/metrics`,
jaeger are the whole face); repo tiers, unverified client identity
headers, overlays,
residency, a bespoke enterprise identity plane (APIM verifies Entra;
reuse LiteLLM user/JWT controls if the deployed version/license allows);
servicemon richness (the health sidecar owns verdicts — outside-process
law).

## Config

- **Strictly JSON5** — `*.settings.json5`. No yaml is authored by us,
  ever. (litellm's internal engine file is GENERATED at boot from our
  JSON catalog; it is an artifact, never repo config.)
- **Secrets are PATHS**, never values. `key: "/etc/buckle/keys/x.key"`.
- **Compose is wiring only** — image, ports, mounts, env PATHS. No
  providers, no peers, no limits in compose.
- **Settings compose by deep merge**: `default.settings.json5` ⊕
  `<buckle>.settings.json5` ⊕ over-layer, then `safeParse` — fail
  loud. The over layer (`--over` / `BUCKLE_SETTINGS_OVER`) is how ONE
  settings file serves both modes: stub compose injects stub provider
  urls as `test/deploy/settings/b*.stub.json5`; NO over = real mode
  on registry defaults. Unit topology lives in
  `test/deploy/settings/`; `deploy/settings/` is the real single hub.
- **Provider registry** (`buckle.provider.registry.zod.ts`): the ONE
  home for a recognized provider's real url/dialect/catalog headers/
  key env+file. A settings entry may omit `url`/`dialect` (the
  registry default applies); an unknown label without an explicit
  url/dialect fails loud at parse (as zod ISSUES — never a thrown
  exception through safeParse). The capture tool, the catalog pull,
  and engine-gen all read it. All catalogs pull at `{url}/models`
  (copilot needs its `copilot-integration-id` header and serves
  `/models`, not `/v1/models`).
- **Fetch, don't declare**: model lists are FETCHED from providers and
  peers. Settings declare providers, keys, peers, grants, limits, and
  per-model OVERRIDES only.
- **Existing local real-mode test launcher**:
  `bun tools/src/buckle.real.ts render|up|status|down` mints topology
  keys, copies muramasa provider keys, pre-seeds a Copilot PAT cache,
  and generates engine
  yamls from the LIVE catalogs (`os.environ` keys only — never values;
  `drop_params` + per-leg `disable_background_health_check` are the
  W3081 lessons), and writes 0600 `real.env`. Runtime home
  `~/.config/fleet-buckle/`. `compose.real.yaml` shares the 47xx ports
  with the stub stack — never both up. This legacy shared-PAT test
  shape is not the human personal-BYOC route. It may support the isolated
  owner-worker engine mode only after the live proof in `tasks/plan.md`.
- **Engine gate**: settings `keys.engine` names a key file; when
  readable the engine leg carries `Bearer` and every litellm enforces
  it as `master_key` (litellm only ENFORCES `sk-`-prefixed values —
  mint with `sk-engine-`). Absent/unreadable file = no header = open
  engine (the stub mode is exactly this). Proven: anonymous 401,
  wrong key refused, gated chats + hop green.

## Federation

- **Downstream ONLY.** `hubs` lists peers we pull from. A buckle never
  calls upstream; the graph is acyclic by construction.
- **Per-hop grants.** A downstream peer's models appear only if the
  requesting principal holds a grant on that peer, checked against that
  peer's own registry. The same law governs the HOP: a chat for a
  peer-origin model forwards verbatim to that peer (`models.use`
  re-checked THERE — the peer's registry decides, not the head's
  belief). The peer token (its `token_file`) rides the hop; the W3C
  trace continues; the serving chain rides `x-fleet-buckle-served-by`
  (each buckle prepends its label — the client sees `b1,b3`); the
  ridden hubs ride `x-fleet-buckle-hop-path`, and a hub already on it
  refuses re-entry (the loop guard — downstream-only by construction,
  guarded anyway). A 429 at the hop RELAYS with `Retry-After`; any
  other peer refusal surfaces as an `unavailable` problem NAMING the
  peer — hop authz is operator-facing, never the client's fault.
- **The federated catalog is a SET.** One row per model id, no matter
  how many hubs serve it: a machine configuring b1+b2+b3 as available
  hubs never grows duplicate or triplicate rows. Precedence is
  deterministic — own provider rows win (never hop for what we serve),
  then peers in `hubs`-declaration order. Transit copies never re-enter:
  a hub pulls only the peer's DIRECT provider rows (`origin kind=
provider`), so a chain (b1→b2→b3) plus a direct edge (b1→b3) still
  counts b3's models once.
  A peer model outside the requesting grant's `peers` is
  indistinguishable from an unknown model (404 — no topology leak).
- Current code has generic principals (`human|developer|agent|service`),
  groups, tiers, and overrides. Azure rollout: APIM validates the Entra
  access token and forwards the verified user identity plus token to
  Buckle. Buckle maps that identity for federation, context policy, and
  logs, and uses LiteLLM's native user/team controls where the deployed
  version and license support them. The model wire must reject APIM
  bypass; GUI-only OIDC is not a substitute.

## Code

- **Types are zod-anchored.** Every data shape lives in `src/schemas/`
  as `buckle.<thing>.zod.ts`; types are `z.output`, never hand-written.
  **ZOD SCHEMAS FIRST → TYPES DERIVED FROM IT, ALWAYS** — no
  compartment is exempt (gui, tools, tests included):
  the schema is the source, the type is `z.infer`, a hand-written
  `interface`/`type` standing in for a wire/config shape is a defect.
  Codecs parse in/out at every boundary; failures are a `validation`
  problem, loud.
- **No try/catch — typed Faults.** `src/fault.ts` is the ONLY catch
  boundary (it classifies fetch/parse failures into the fault taxonomy;
  `src/settings.ts` readToken/listDir likewise). Every other module
  composes typed `Fault` values through `Outcome` unions — seams log
  them (`logFault`) and map them to problem+json naming the kind
  (`engine timeout`, `peer b2 refused`). check-laws fails any other
  `catch` in `src/`.
- **Knobs have one home: the settings schema.** `process.env` is read
  ONLY by the settings loader (`src/settings.ts`, argv/env paths).
  Every bounded wait and url knob lives in `BuckleSettings`
  (`timeouts.*`, `engine.url`, `telemetry.otlp_url`, `hub.ports`) —
  a module-local constant or a scattered env read fails check-laws.
  Tests derive knobs from `mergeSettings(...).timeouts.hop_ms`, never
  re-declare them.
- **Unit worlds are hermetic by construction.** `src/kit.ts` composes
  `defaults ⊕ world opts` — never the b1 demo file. A world's
  providers/hubs are EXACTLY its stubs: nothing real, nothing docker,
  nothing inherited. (A world inheriting b1 once reached the live
  stack through /etc/hosts and leaked real openrouter rows into unit
  assertions.)
- **Composed capability folders.** A capability is a FOLDER
  (`federation/`, `catalog/`, `proxy/`, `access/`, `metrics/`,
  `events/`, `context/`, `trace/`…) with
  single-job files `buckle.<thing>.<role>.ts`, colocated
  Playwright specs, `fixtures/`, and a thin `index.ts`
  barrel. Nothing imports past another folder's barrel. The DAG:
  `schemas ← fault ← {problem, settings, pick} ← {access, admission,
federation, events, context, trace} ← {catalog, metrics} ← proxy ←
main`. The events bus is the pipeline's ONE write seam (emitters
  use the constructor family, never hand-assembled literals); the
  context judge is the ONE ingress decision seam (default inert).
  Composition roots live FLAT in `src/` (`main.ts`, `settings.ts`,
  `kit.ts`, `fault.ts`, `problem.ts`, `pick.ts`) — check-laws exempts
  them from folder naming.
- **One job per file.** If you cannot name the file's `<role>`, split
  it. Variants are files (`.fetch.anthropic.ts`), not `if` branches.
- **Line caps**: warn at 400 (you are composing wrong), stop at 1200,
  hard fail at 1500.
- **Bun installs and runs in this repo.** Use `bun install --frozen-lockfile`;
  keep exact versions and the committed `bun.lock`. This is an explicit
  standalone-repo deviation from the house standard's npm workspace
  installer. Dependency budget: `zod` at runtime — everything else is
  the platform.

## Quality

- Preserve HTTP status, `Retry-After`, request/call IDs, and semantic
  problem kinds across every hop. A 429 budget denial is not a generic
  retry signal; 503 and upstream timeouts stay distinct. Stream bytes and
  terminal/error outcomes through the gateway without invented success or
  zero usage. Bound deadlines and backpressure at the real boundary.
- Keep policy and external effects in their declared capability owner;
  leaf mappers stay pure. Parse untrusted wire/config data with named Zod
  schemas and validate public output. Real hosts, keys and limits stay in
  machine config. A published Buckle image must work without a sibling
  checkout. Check the changed dependency and import graph before landing.

Before calling a change done, run `qlty smells --all` and `qlty check --all
--filter eslint`. Run `qlty check --all --filter knip` when exports, files,
scripts, or dependencies change. Review every finding in the touched code.
Decompose functions by responsibility; wrapping many parameters in one
object or extracting a one-use helper solely to lower a metric is not a fix.
Remove duplicated implementation and unused exports rather than hiding
findings with suppressions. The existing backlog is visible in these commands;
new code should not add to it.

## Tests

- New tests use **@playwright/test**, including pure unit tests. The existing
  colocated `*.test.ts` Bun suites are migration debt: keep them green and
  migrate by capability; do not add another Bun test. Pure tests belong beside
  their source in `src/<capability>/`; Docker/API tests belong in `test/`.
- `playwright.config.ts` is the project map: `unit` runs colocated pure
  `src/**/*.spec.ts` tests without Docker; `stack-setup`/`stack-teardown`
  own the shared Docker topology; `smoke` gates `e2e`, `federation`, `load`,
  and `rolling`; `stage0` and `azure` own isolated topologies. A spec must
  match exactly one primary project. Do not add global setup or make an
  isolated project boot the shared stack. Run a project's `--list` before
  changing its matching rules.
- Shared topology and lifecycle belong in `test/kit/` and `test/setup/`.
  Test-specific clients, auth, parsed stub evidence, and cleanup belong in
  typed `test.extend` fixtures under `test/fixtures/`; specs request fixtures
  and assert behavior. Put reusable multi-spec sequences in `*.flow.ts`.
  Prefer Playwright's `request` fixture for HTTP contracts. Never mint keys,
  start Compose, or keep mutable cross-test state in a leaf spec.
- Test data stays in `fixtures/` and is parsed through Zod. Tag new specs by
  layer (`@unit`, `@api`, `@smoke`, `@slow`, `@load` as applicable). Keep
  load tests scoped to a deliberate project and report completed requests,
  latency and error classes, not only a green exit.
- Run `bun --bun playwright test --list`, the affected project(s), then the
  existing `bun test` migration baseline, typecheck and `bun run check`.
- Docker Desktop and the Azure VMSS are valid e2e targets for the same
  versioned wire contract. Keep each target in a separate Playwright project
  with its own typed endpoint/auth fixtures and teardown. The current
  `azure` project is a local, self-composed Azure-shape rig, not a live VMSS
  test. A future live project must be explicit opt-in, use pinned image
  digests and off-repo credentials, and never depend on `stack-setup`.
- `openapi.json` is GENERATED from the wire schemas, committed, and
  diffed — consumers and tests use it; it never drifts from code.
