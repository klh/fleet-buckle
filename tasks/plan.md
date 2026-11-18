# Fleet Buckle delivery plan

This plan owns gateway delivery. Worker owns Pi Durable runtime, Absurd work intake and Gondolin
placement. Stable task IDs below are the only dispatch index; the later requirements retain the
source links and acceptance detail. No runtime capability is claimed complete here.

## Reviewed state and completed scope

Reviewed source: `f290e1d` (2026-11-18). [Completed work](completed.md) records B13
copied-runtime removal and scoped fixes/test receipts. B15 retains unused dependency cleanup and
release regression/qualification; archived implementation does not waive those gates.
Other B packages remain partial, blocked or unqualified. Pi reports deployed Buckle `807cf85`,
config-only LiteLLM and no Lens/protocol activation; current main is not a qualified deployment.

## Reading order

Read vocabulary and execution rules, then the shared gates and task cards. Follow referenced
requirements when implementing a card. Task numbers are stable identifiers; dependency fields
determine readiness. Architecture source maps stay active reference material. Completed B13 resolves in [completed.md](completed.md), not as a new dispatch card; B15 retains its residual cleanup and release gates.

## Start here after a context reset

Worker owns the runner runtime and host operations. Buckle owns the model and protocol gateway. The
Worker plan is authoritative for Pi/Absurd semantics; the Buckle plan is authoritative for gateway
policy and the shared delivery gates. Neither plan makes the other repo's source part of its build.
README.md indexes retained operating/evidence documents. Removed architecture and dispatch proposals
remain in Git history. If a referenced document contradicts these boundaries, resolve that document
before dispatching affected work; archived plans confer no implementation scope.

A new implementing agent first reads its own AGENTS.md, this vocabulary, the execution rules and its
task card. Then read the card's requirement sections and upstream source map. W00/B00 establish
current code/runtime facts; historical deployment observations below are inputs to refresh, not
proof that the target is already running. File paths in cards are repository-relative; W and B IDs
identify work packages in these plans, not an existing CLI command or a Pi task type.

Before W03, execute explicitly assigned bootstrap leaves in their owning repo using the session's
available coordination surface. W00/B00 record that surface and active owners in their inventory. Do
not assume Absurd, a runner-launch CLI or a monorepo dispatcher exists yet. The target queue is
accepted at W03/W05/W16 before W17 uses it for delivery work.

## Binding vocabulary — use these meanings throughout

| Word                           | Exact meaning                                                                                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pi Durable**                 | The agent runtime and persistence library inside the guest: Harness, root conversation, per-conversation agent, submissions, tasks, hooks, signals, storage and recovery. It is the runner execution authority.      |
| **Gondolin**                   | The isolation substrate that creates the microVM guest and its mounts; it does not plan, schedule or persist Pi mission steps.                                                                                       |
| **Runner**                     | One persistent Pi Durable Harness and configured root agent, identified by a stable UUID and journal, executing in one Gondolin guest at a time. A replacement guest resumes the same runner.                        |
| **Supervisor**                 | The runner's Pi root agent when it plans, delegates, waits and reconciles using Pi capabilities. Capitalized **old Supervisor** names only the external queue/poller/spawn code being deleted.                       |
| **Guest**                      | The Gondolin microVM that runs Pi Durable, its extensions, task phases and model client. Its root filesystem is disposable; the journal is durable.                                                                  |
| **Worker host**                | The service outside the guest that admits/places runners, fences one writer, arms wakes, maintains recovery records and exposes authorized commands/reads. It does not decide mission steps.                         |
| **Charter / template**         | Reviewed Markdown instructions plus validated variables and revision given to the Pi root at inception. The LLM interprets it as a continuing mission; it is not a compiled job recipe.                              |
| **Pi journal**                 | Pi Durable storage containing authoritative transcript, submissions, task checkpoints, waits, child ownership, typed documents and effect receipts. Pi resumes its steps from this storage.                          |
| **Host DB**                    | Postgres with Worker-owned runner/admission tables, Absurd external-work queues pulled by Pi supervisor guests, and host-operation queues pulled by Worker hosts. It never mirrors Pi journal steps.                 |
| **Host operation**             | A finite Absurd task for placement, wake, stop or reconciliation. Its task ID is operational metadata, never a Pi task ID or runner UUID.                                                                            |
| **Work item**                  | An external request/event queued as an Absurd task for an eligible supervisor to pull and correlate to a Pi submission or signal. It is not a Pi task.                                                               |
| **Submission**                 | Pi's durably admitted conversation input/write/continue, deduplicated by conversation-scoped `requestId`; its ID and settlement are Pi-owned.                                                                        |
| **Signal**                     | A typed value delivered to a Pi task's unique wait key; repeated delivery to the same key returns a duplicate/closed result.                                                                                         |
| **Task**                       | Pi Durable's checkpointed state machine for ongoing work, sleeps, joins and effects. Its live graph and outcome are Pi-owned.                                                                                        |
| **Child / specialist**         | A Pi-owned conversation or task in the same Harness; a separately placed remote child is another runner with a parent-owned admission/result/cancel task.                                                            |
| **Runner image / tool seed**   | The runner image contains Pi Durable and approved extensions inside Gondolin. The separate tool seed contains execution tools and does not own Pi state.                                                             |
| **Buckle / LiteLLM / GUI API** | Buckle authenticates and routes model/protocol traffic; LiteLLM chooses provider deployment and records gateway evidence; the separate GUI API owns presentation, filtering and browser SSE. None schedules Pi work. |
| **Absurd task**                | A Postgres-backed work-item delivery or host operation with its own queue/task/run IDs. An unqualified **Task** below always means a Pi task.                                                                        |
| **Hub**                        | One configured deployment boundary exposing Buckle and associated services; it is not a runner or Pi Harness.                                                                                                        |
| **Writer epoch**               | A monotonically advancing placement generation checked by the host and guest. A lease expiry alone does not authorize a second journal writer.                                                                       |
| **Lane / integration lane**    | An implementation assignment with an exact write allowlist. Integration is a serialized role per repo/deployment, not another runtime supervisor service.                                                            |
| **Coordinator**                | A Pi root supervisor role. It uses the same runner runtime and ownership rules.                                                                                                                                      |
| **Job**                        | Use only for LiteLLM maintenance jobs or archived pilot terminology; do not use it for a runner, Pi task or host work item.                                                                                          |

## Execution rules

This backlog is the only task list in this document. Later sections are binding requirements
referenced by task IDs, not additional work queues. A task is ready only when its dependencies have
accepted evidence. Pending means unverified here, not proof that no implementation exists. Reconcile
current code, active claims and live receipts before dispatch.

Each ID is a work package. Before dispatch, split a package into leaves with at most five production
files and one acceptance case per leaf. Record the exact file allowlist, input contract revision and
evidence path in the bootstrap coordination surface recorded by W00/B00, then in Absurd after W03;
keep the package ID as parent. Do not create a Markdown claim ledger. A leaf owns its tests in the
same allowlist. Distinct files in the same directory are not implicit permission to change a shared
contract. No simultaneous owner may edit the same file.

The integration lane alone owns entry-point wiring, dependency manifests, lockfiles, shared schema
exports, generated-file sources, Playwright project configuration, Compose manifests and release
pins. Feature lanes consume frozen contracts and provide modules plus scoped tests. Contract changes
return to the contract owner; consumers resume after one reviewed revision. No sibling source
imports or copied schemas: publish a versioned contract artifact from its owning repo and validate
it in consumer fixtures.

A cross-repo handoff includes producer commit/image digest, contract revision, schema/fixture
artifact and acceptance receipt. W01/B01 choose and record the actual artifact publication mechanism
before consumers start; no lane invents a second schema package or imports a sibling path. During
parallel development a consumer can use contract fixtures, but it cannot close integration
acceptance until the producer receipt exists.

Integration ownership is per repository and must name an active agent or runner UUID in the dispatch
record. A feature lane submits a reviewed patch/config input to that owner for shared-file changes.
It does not wait for a completed package such as B02 to become a live person or service; the
integration role continues through later packages.

Use existing Playwright fixtures and test kits. A single setup project starts the rig, a readiness
project polls real required services until a bounded deadline, and flow projects depend on readiness
through Playwright project dependencies. Teardown owns cleanup. Every parallel rig has unique
project names, ports and volumes. Fixtures use the VMSS-available model wire; hermetic runs use a
Copilot stub, never a private Mac GLM endpoint. Live qualification uses the actual entitled VMSS
catalog.

Close a leaf with its commit, relevant test command/result, image/config revision and durable
receipt; close the package only when all acceptance cases pass. Fixture success does not substitute
for live deployment proof. Completed evidence leaves this active plan after review; preserve it in
[completed.md](completed.md) with its exact scope and residual gate. Never archive an active API/source map.

## Surface ownership

B00 reserves exact files under existing `src/` responsibility directories. B03 owns model-wire
files; B04 owns access/identity files; B05 owns retry and deadline files; B06 owns gateway
metrics/trace files; B09 owns decision catalog/proxy files. These reservations must be disjoint
before dispatch. B10/B11 qualify native gateway protocol routing; W18 owns the Worker protocol
endpoints. B02/B14/B15 share one serialized integration lane for config generation, manifests, test
topology and deployment. Feature lanes provide reviewed inputs to that owner instead of editing
shared files.

## Parallel delivery and integration gates

Task IDs beginning W belong to [Worker plan](../../fleet-worker/plan.md#work-breakdown); B and D IDs
belong here. Belt and GUI stay independent repositories; this plan consumes their published
endpoints/images and contracts. Their files are never implicitly assigned to a Buckle or Worker
lane.

| Gate                                     | Ready branches (each card's dependencies still apply)                  | Exit                                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 0 — inventory                            | W00 and B00                                                            | Actual runtime, ownership and Gondolin feasibility recorded.                        |
| 1 — contracts                            | W01, then B01                                                          | Worker API and gateway identity/evidence artifacts frozen.                          |
| 2 — foundations                          | W02, W03, W08 and B02                                                  | Guest bootstrap, queue/store, charters and engine deployment accepted.              |
| 3 — domain modules                       | W04, W05, W13, W15 and B03, B04, B06; W06 follows W04; W14 follows B06 | Placement/intake/commands and scoped model route ready.                             |
| 4 — first pull                           | W16; B05 can run alongside; W18 follows W06/W13                        | One real charter→pull→Pi→model/read-only-tool outcome survives guest replacement.   |
| 5 — trial readiness                      | W07 and W12; W09 follows W07; W10 follows W09; B14 follows W16/B05/B06 | W17's wake, mission, local-child, effect, read/trace and gateway gates accepted.    |
| 6 — backlog trial and remaining features | W17; W11, B07–B12 and W20 may proceed or be queued by W17 when ready   | Accepted remaining work, including remote protocols, Lens and Auto Router adoption. |
| 7 — release                              | B15, then W19                                                          | Full release evidence, external E-GUI gate and removed obsolete paths.              |

B09 may start after B01/B02/B04 and E-BELT; B08 after B05/B06 and E-BELT. These Belt branches do not
block W16/W17. B07 can start after W14; B10/B11 after W18. Finishing a gate does not require
unrelated later branches to finish. Shared-file integration remains serialized per repository.

This table is an overview. Each card's dependencies are authoritative and may delay a lane within a
gate. Do not start a dependent implementation merely because its gate is visible. Integration wiring
and deployment are serialized; independent modules and their scoped tests run in parallel. Do not
hold the backlog trial until every optional feature or remote-child case is implemented: its
explicit prerequisites define the first usable system. Required later features still gate W19/B15.

The [Absurd backlog trial](../../fleet-worker/plan.md#absurd-backlog-trial) is the single trial
procedure for both repos. W17 imports a reviewed snapshot of remaining ready leaves, including
Buckle tasks. File reservations and dependency-ready admission must work before that import. The
import manifest is the runtime snapshot; these Markdown plans remain design and acceptance records,
not a live queue.

## Cross-repository handoffs

A shared feature has separate producer and consumer tasks; it never gives one lane permission to
edit both repos. Producers publish a versioned artifact and receipt. Consumers may implement against
its fixture first, then pass integration acceptance against the actual producer.

| Producer                                     | Required handoff                                                                            | Consumer and ordering                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| W01                                          | Runner/work/command/read Zod contract artifact with receipt and epoch semantics             | B01 consumes before gateway contracts are frozen.                                                                  |
| B01, B06                                     | Correlation schema and reachable gateway metrics/spend collector                            | W14 instruments and joins Pi evidence; B07 follows W14 for real Lens traces.                                       |
| B02, B03, B04                                | Pinned engine + scoped model route with real tool/stream receipt                            | W16's first supervisor work uses it; Auto Router is not required yet.                                              |
| W06, W13, W18                                | Authorized Worker command/read API and thin MCP/A2A endpoints                               | B10/B11 register and qualify those endpoints through LiteLLM/Buckle; Worker never implements the gateway registry. |
| W16, B05, B06                                | First live Pi pull plus gateway reliability/evidence                                        | B14 accepts the integrated baseline; W17 follows B14 and its listed Worker reliability gates.                      |
| E-BELT, B08                                  | Qualified classifier and callable generated router alias with served-model/attempt evidence | W20 proves Pi must/prefer/context/tool semantics before default traffic changes; B15 follows W20.                  |
| W17 plus remaining required feature receipts | Backlog trial, reviewed commits, scope/identity/stream/recovery evidence                    | B15 qualifies gateway release; W19 follows B15, remote-child proof and E-GUI to retire old runtime.                |

No gateway task creates Worker mission logic. No Worker task regenerates Buckle engine
configuration. A required change in the other repo becomes a linked leaf owned there, and the
consumer waits for its receipt.

## GUI client boundary — existing API first

The GUI repository owns a Buckle API client and a separate GUI-only presentation API. It consumes
existing gateway model/catalog/tree/stats/admin/protocol faces with appropriate scopes; the browser
never receives gateway administrator credentials. Preserve current route names, payload semantics
and gateway responsibility. OpenAPI coverage may be corrected to describe existing mounted routes.
Do not add GUI discovery, pagination, dashboard summaries, sessions, browser SSE or runner workflows
to Buckle. GUI config binds associated service origins; one Buckle base URL is not evidence of an
existing general service-discovery API.

A producer change requires a concrete missing generic domain capability: name the existing API
examined, the absent domain operation/data, its authority and a reusable contract, then assign a
scoped owner leaf. The current W06/W13 Worker bindings and B06 evidence gaps qualify for that
review; a preferred table shape does not. GUI client/projection work never blocks on a cosmetic
Buckle API redesign. [GUI plan](../../fleet-buckle-gui/plan.md) owns all GUI deployment work.

## External acceptance gates

| Gate   | Producer and required artifact                                                                                                                                                                                                                                      | Consumers                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| E-BELT | fleet-belt supplies an immutable release manifest: model/checkpoint/backend/image revisions, private endpoint/auth contract and independent real System One inference, capacity, quality and recovery receipts. [Belt plan](../../fleet-belt/plan.md) owns serving. | B08, B09; other baseline work continues while absent.       |
| E-GUI  | fleet-buckle-gui supplies a compatible published image and 100-runner observation receipt for Worker contract revision, snapshot/reconnect/gap behavior and authenticated commands. [GUI plan](../../fleet-buckle-gui/plan.md) owns implementation.                 | W19; W17 can use authorized Worker reads plus CLI evidence. |

W00/B00 record artifact locations and actual revisions in their handoff; B08/B09/W19 validate the
corresponding gate before acceptance. A source file, stub or README claim is not a live release
receipt. Missing external artifacts block only their consumers. Belt/GUI implementation changes
require a separately scoped assignment in that repo. Older Belt B8–B10 references describe
cross-repo integration outcomes: they map to Buckle B02/B08/B09 and Worker model policy, not
duplicate implementation owners. Broader CLI adoption remains D01/deferred regardless of older Belt
wording.

## Work breakdown

### B00 — Freeze gateway decomposition

- **Status:** partial implementation; remaining acceptance open; reviewed 2026-11-18.
- **Depends on:** none.
- **Owns:** tasks/refactor-inventory.md; no runtime edits.
- **Remaining:** Refresh reachable-source and deployed-image/config inventories, including the already removed src/agents tree and stale OpenAPI coverage. Reserve exact integration files; do not create discovery, GUI read models or workflow endpoints in Buckle.
- **Verification:** Import/route map plus live image/config receipt; shared-file ownership is
  explicit.

### B01 — Freeze gateway identity and evidence contracts

- **Status:** partial implementation; remaining acceptance open; reviewed 2026-11-18.
- **Depends on:** B00, W01.
- **Owns:** src/schemas/ and versioned contract fixtures; integration owns exports.
- **Remaining:** Publish compatible existing gateway schema/OpenAPI artifacts and actual route/scoping contracts for clients, including mounted faces currently omitted from OpenAPI. Bind Worker identity/evidence consumers and fix schema-test framework discovery. Documenting an existing route is not permission to redesign it for a page.
- **Verification:** Schema denied/malformed cases and compatible published fixtures for Worker/GUI.

### B02 — Qualify engine deployment and config generation

- **Status:** partial implementation; remaining acceptance open; reviewed 2026-11-18.
- **Depends on:** B01.
- **Owns:** tools/src/buckle.gen-engine-config.ts; deploy/engine/, deploy/settings/, compose,
  package and lock files; integration lane.
- **Remaining:** Qualify the effective engine URL/credential, pinned generated configuration and live canary; then deploy the required DB lifecycle, roles, migrations, salt/backup/restore, logging and trusted-proxy settings. Current config-only LiteLLM and generated YAML do not establish DB-backed features or an available UI.
- **Verification:** Generated config round-trip, authenticated engine canary, DB outage/backup
  restore; no PAT exposure.

### B03 — Preserve base model wire

- **Status:** partial implementation; remaining acceptance open; reviewed 2026-11-18.
- **Depends on:** B01, B02.
- **Owns:** src/proxy/ model/stream files reserved by B00; no identity or retry-owner files.
- **Remaining:** Qualify existing model-wire helpers against the actual entitled engine/provider path: tools, quiet/cut/cancel streams, terminal/in-band errors, drop/sanitize/provider parameters and JSON/reasoning behavior. Preserve byte identity and do not infer completion or token usage at response headers.
- **Verification:** Hermetic Copilot wire matrix and one live entitled VMSS model/tool stream; no
  Mac-only dependency.

### B04 — Enforce scoped caller identity

- **Status:** partial implementation; remaining acceptance open; reviewed 2026-11-18.
- **Depends on:** B01, B02.
- **Owns:** src/access/, src/admission/, identity passthrough files reserved by B00.
- **Remaining:** Retain the real-ingress revocation/scoped-token fix from #29. Bind and qualify required LiteLLM scoped identities/keys, quotas/budgets and revocation at both boundaries, including DB loss and BYOC isolation. Entra profiles and expanded GUI RBAC stay deferred.
- **Verification:** Deny, revoke, quota, DB failure and cross-user isolation cases at both
  boundaries.

### B05 — Bound retry and routing policy

- **Status:** partial implementation; remaining acceptance open; reviewed 2026-11-18.
- **Depends on:** B03, B04.
- **Owns:** src/proxy/ retry/deadline files reserved by B00; config requests handed to B02 owner.
- **Remaining:** Choose and enforce one actual attempt/deadline owner across Pi/gateway/provider. Prove pre/post-first-chunk fallback, hard pins/grants, Retry-After and long quiet streams against the pinned chain; manually sending another request is not an internal retry-budget test.
- **Verification:** Classifier/model/peer failure, quiet stream and Retry-After tests show bounded
  attempts and no false terminal.

### B06 — Publish gateway metrics and spend evidence

- **Status:** partial implementation; remaining acceptance open; reviewed 2026-11-18.
- **Depends on:** B01, B02.
- **Owns:** src/metrics/ and src/trace/ gateway collectors; no Lens deployment files.
- **Remaining:** Bind terminal model-attempt/usage/spend correlation into the real request path and private engine collector. Publish existing or genuinely missing generic evidence reads for consumers; qualify unknown price, spend lag, collector loss, retention/SLO/alert ownership. No GUI summary or page-specific log endpoint.
- **Verification:** A schema-valid fixture carries the W14 correlation fields; missing-price,
  spend-lag and collector-outage cases pass. W14 subsequently proves a live Pi call joins this
  collector.

### B07 — Deploy Lens with agent traces

- **Status:** partial implementation; remaining acceptance open; reviewed 2026-11-18.
- **Depends on:** B02, B04, B06, W14.
- **Owns:** deploy/lens/ and tracing configuration; shared Compose edits through integration lane.
- **Remaining:** Deploy and qualify the existing Lens/ClickHouse scaffold with pinned images, restricted access, retention, backup and trace credentials. Store native Worker model/tool spans, join spend and run a redacted investigation. There are no running Lens containers in the verified VMSS baseline.
- **Verification:** Stored/redacted trace, linked spend, backup restore and one useful investigation
  with current release qualification.

### B08 — Enable Auto Router with Belt Kev

- **Status:** not implemented / producer-blocked; reviewed 2026-11-18.
- **Depends on:** B04, B05, B06; E-BELT.
- **Owns:** routing config specification/fixtures; engine generator edits serialized through B02
  owner.
- **Remaining:** Consume qualified E-BELT System One inference and implement generated Auto Router deployment/tier/alias configuration on a supported pinned LiteLLM version. Prove hard pins, grants, context/tools, outage fallback and matched quality/cost/p95 before W20/default traffic adoption.
- **Verification:** Real Kev call, classifier down, model down, tools/context/usage and matched
  quality/cost/p95 evidence.

### B09 — Advertise authorized Kev decisions

- **Status:** not implemented / producer-blocked; reviewed 2026-11-18.
- **Depends on:** B01, B02, B04; E-BELT.
- **Owns:** src/catalog/ decision files and decision proxy module reserved by B00.
- **Remaining:** Implement/qualify Kev decision capability in the existing catalog/proxy contract using E-BELT origin and independent inference health. Prove authorization, stale/down behavior and decision wire; do not advertise Kev as chat.
- **Verification:** Entitled/denied, stale inference health and decision wire tests.

### B10 — Expose scoped MCP commands

- **Status:** partial implementation; remaining acceptance open; reviewed 2026-11-18.
- **Depends on:** B03, B04, W18.
- **Owns:** MCP gateway authorization/passthrough files reserved by B00; registration config through
  integration lane.
- **Remaining:** Consume mounted W18 Worker MCP commands/reads, repair gateway/domain tool-name mismatch and have the generator consume reviewed native registry/grant config. Qualify an authorized replay-safe command and denied tool end to end; gateway transport never owns execution.
- **Verification:** Rejected unauthorized tool and one replay-safe command through Buckle/LiteLLM to
  Worker.

### B11 — Expose remote A2A runner invocation

- **Status:** partial implementation; remaining acceptance open; reviewed 2026-11-18.
- **Depends on:** B03, B04, W18.
- **Owns:** A2A gateway authorization/passthrough files reserved by B00; registration config through
  integration lane.
- **Remaining:** Register the mounted Worker A2A face through native LiteLLM and bind persistent runner/Pi/epoch identities. Remove any gateway-side substitute execution state; prove real discovery/send/stream/status/resubscribe/cancel, duplicate delivery and restart on the same fenced runner.
- **Verification:** Remote caller duplicate delivery, restart and cancellation against the same
  fenced runner.

### B12 — Disposition optional engine capabilities

- **Status:** partial implementation; remaining acceptance open; reviewed 2026-11-18.
- **Depends on:** B05, B06.
- **Owns:** tasks/engine-feature-decisions.md and feature-specific fixtures; no shared generator
  edits.
- **Remaining:** Review the existing proposed capability dispositions against every detailed requirement and record actual owner decisions. Complete missing option coverage and matched on/off evidence before any enablement; the document enables nothing and cannot defer required Lens/Auto Router/MCP/A2A.
- **Verification:** Matched feature-on/off evidence, owner and rollback per enabled feature; every
  documented optional capability has a disposition.

### B14 — Accept the integrated test rig

- **Status:** partial implementation; remaining acceptance open; reviewed 2026-11-18.
- **Depends on:** B03, B04, B05, B06, W16.
- **Owns:** test/setup/, test/fixtures/, test/kit/, test/deploy/, playwright.config.*; integration
  lane.
- **Remaining:** Repair actual Playwright discovery/framework/key-initialization failures, use the published forward Worker image and accepted W16 path, and qualify isolated topology/readiness, real identity/attempt/usage joins and an entitled live VMSS canary. Passing helper tests do not accept this rig.
- **Verification:** Parallel hermetic stacks and live VMSS canary receipts; zero live issue
  fixtures.

### B15 — Qualify and release production features

- **Status:** partial implementation; remaining acceptance open; reviewed 2026-11-18.
- **Depends on:** B07, B08, B09, B10, B11, B12, B13, B14, W17, W20.
- **Owns:** test/rolling/, test/load/; deployment manifests/release pins in integration lane.
- **Remaining:** Remove the unused Pi dependencies left after completed B13 removal; retire embedded deploy/gui packaging after the independent GUI release is accepted and its owner switches ingress. Keep container wiring separate from gateway APIs, re-run gateway regressions and qualify the combined required features on running digests. Prove DB/Redis/engine loss as applicable, real in-flight eight-runner interruption, 100-runner GUI receipt and forward rollback; merge state is not deployed acceptance.
- **Verification:** Pinned release plus representative Fleet throughput, eight-runner interruption
  and linked 100-runner GUI/Worker observation receipt.

### D01 — Human Entra/APIM and bounded CLI proof (deferred)

- **Status:** deferred; activate only on an explicit owner instruction.
- **Depends on:** explicit activation; B03, B04.
- **Owns:** test/manual/entra-login/ and Entra/APIM test fixtures; deployment edits serialized.
- **Acceptance:** Meet the human BYOC requirements below with two-user isolation and bounded
  Claude/Copilot proofs. Broader client installer/MCP/Lens integration remains deferred.
- **Verification:** Real access token, denied spoof/anonymous calls, renewal/revocation and tool/SSE
  receipt.

### D02 — On-premises H100 federation (deferred)

- **Status:** deferred; activate only on an explicit owner instruction.
- **Depends on:** explicit activation; B05, B06.
- **Owns:** src/federation/ and federation test fixtures; deployment edits serialized.
- **Acceptance:** Meet the federation requirements below after inventorying actual inference and
  microVM-capable hosts. Preserve provider/credential boundaries.
- **Verification:** Entitled and denied cross-peer calls, stream/usage provenance and peer-loss
  receipt.

## Deferred infrastructure dispositions

krun/alternative VM backends, zram, settings distribution pins and Mac upstreams remain outside the
current release. W00/B00 must record their existing state and avoid removing working configuration
accidentally. Activating one requires its own bounded task and acceptance gate; none is a hidden
prerequisite of the Absurd backlog trial.

## Gateway requirements

### Model and credential guardrails

- Buckle authenticates and attributes callers, preserves supported model wires and streaming,
  federates catalogs and routes to LiteLLM. It never launches a Pi runner or owns its task graph.
  LiteLLM resolves provider deployments, retries and allowed fallbacks; the Pi runner chooses its
  requested model under its own `must`/`prefer` policy.
- A concrete `must=` model list is an owner pin. `prefer=` tries listed models in order before
  approved defaults. Only an explicitly eligible router alias may enter Auto Router. Qualify the
  served model, tools, context, SSE and usage before selecting that alias.
- Human BYOC and isolated engine-held owner-worker credentials remain distinct. An auth failure
  cannot switch modes. Upstream PATs and keys must not enter the runner image, Pi journal, trace or
  work brief. B04 delivers scoped LiteLLM virtual keys for runners. Future provider-secret
  custody/self-service is separate; it does not defer these runtime access controls.
- The checked-in Azure Compose pins LiteLLM by digest. Qualify each upgrade against catalog, auth,
  Messages, tools, SSE and rollback; verify the running digest and effective configuration
  separately.
- Do not impose an arbitrary `max_tokens` cap to mask a model capacity error. Pick a model that
  serves the runner's actual ask shape. Explicit runner budgets and loop limits still protect a
  continuing mission.
- The first acceptance path is Worker API launch and submission on the VMSS. Git is for code and
  charter revision, not work intake. A future multi-host controller may place runners without
  replacing Pi's task scheduler. The current issue queue and spawn loop are retirement targets once
  callers use the direct Pi path.

## Runner architecture requirements (Worker-owned)

The forward architecture uses a continuing Pi Durable runner inside a Gondolin guest, with host
placement/recovery and Buckle model access. Prove one journal and writer, durable effect
reconciliation, background child ownership, operator commands, failure recovery and rollback. First
pin a reviewed upstream Pi commit or release with the needed signal and parked-tool APIs. Design
references include upstream examples
[`22-subagent-background`](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/22-subagent-background.ts),
[`32-tests-after-edits`](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/32-tests-after-edits.ts),
[`34-submit-in-commit`](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/34-submit-in-commit.ts),
[`40-tool-waits-for-webhook`](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/40-tool-waits-for-webhook.ts),
and the [Cloudflare wake/activity example](https://github.com/earendil-works/pi-durable-cloudflare).
Verify the examples against the pinned forward API in the guest image; copying the Cloudflare or
React host is not part of this design.

### Binding Pi Durable source and API map

The [Worker vocabulary and running object](../../fleet-worker/plan.md#one-running-object) define
runner semantics. The [Absurd binding](../../fleet-worker/plan.md#host-db-and-absurd-binding)
defines queue pull, pinned assignment and recovery. The
[complete Pi Durable map](../../fleet-worker/plan.md#binding-pi-durable-surface-map) maps every
upstream README heading and public interface. These are the single architecture/API specifications;
Buckle implements model/protocol routing, identity and evidence at their boundaries.

Worker tasks own runtime and seed changes. B00 inventories Buckle reachability; B13 copied-runtime removal is archived in
[completed.md](completed.md); B15 owns remaining dependency cleanup and qualification. B01 freezes the public contract before independent gateway lanes start.

### Streaming requirements (B03, B05, B14)

There are two different streams. Model requests use the provider's Anthropic/OpenAI SSE dialect
through APIM, Buckle and LiteLLM to Pi AI; preserve event order, tool deltas, terminal markers and
in-band errors. Pi AI emits typed `start`, delta, `done` and `error` events from the provider
stream; its `partial` object is mutable live state, not an event-time snapshot. Consume deltas
immediately and never retain `partial` by reference as a historical event. A transport EOF without
the dialect's successful terminal is an interrupted generation. The operator feed is a GUI
API-owned, authenticated SSE projection of Worker-exposed Pi `watch()` and `watchTaskGraph()` plus
Pi task and external admission receipts. Pi watches are local state subscriptions, **not** an HTTP
SSE server or a replay log. The upstream Cloudflare example uses WebSockets; Fleet's read-only
browser feed may use SSE without copying that host.

The
[Worker operator requirements](../../fleet-worker/plan.md#operator-read-and-command-requirements-w06-w13-w17)
define the browser-feed boundary and snapshot/watch guarantees. B03/B05 verify gateway model
streams; the GUI repo implements browser SSE.

Fleet's Buckle code already adds final-egress SSE heartbeats and checks protocol terminals, but
prior long-quiet/APIM acceptance was unproved. Verify every deployed hop with a representative quiet
stream, tool-use stream, in-band failure, client disconnect and total-deadline case. Record first
byte, quiet interval, last model event, terminal receipt and cancellation at APIM, Azure Buckle,
LiteLLM and Pi AI. A heartbeat on the last hop cannot repair an earlier upstream idle timeout;
configure and test each hop's buffering and limits separately. The operator feed gets its own
reconnect/overflow/crash tests and must show a truthful `reconciling` or `interrupted` state until
the snapshot catches up.

LiteLLM's [SDK exception mapping](https://docs.litellm.ai/docs/exception_mapping) normalizes
provider failures to OpenAI exception classes. Fleet's HTTP clients instead need the
[gateway error contract](https://docs.litellm.ai/docs/proxy/error_reference): preserve status,
`error` shape, `x-litellm-call-id`, retry headers and the request/served-model IDs across Buckle.
Classify gateway auth, budget, cooldown and model-access errors separately from provider throttling,
timeout and content/context rejection. A 429 is not always retryable: budget exhaustion needs a
policy decision, while rate limits honor `retry-after`; 400/401/403 generally require request or
access repair. A failed fallback chain may return the **first** group's status, so bank every
attempted deployment from gateway logs, not status alone. An error after first SSE content arrives
keeps HTTP 200 and appears as an in-band `error` event; Pi must mark that generation interrupted and
must not settle it as a successful completion. Test both first-chunk JSON errors and mid-stream SSE
errors through APIM→Buckle→LiteLLM→Pi. Do not assume A2A, MCP or management errors share the LLM
error envelope.

### Request compatibility requirements (B03)

The checked-in LiteLLM generator emits global `drop_params: true` for Copilot seats. Per the
[drop-params guide](https://docs.litellm.ai/docs/completion/drop_params), that silently discards
unsupported OpenAI parameters; it does not prove the requested tool, reasoning, JSON or cache
behavior actually reached the selected model. For now, prove the Pi worker chat route and a small
Claude Code → Buckle → LiteLLM → Copilot seat tool/SSE round trip. Check the outbound provider shape
and returned behavior for those paths. The broader model × client-wire × feature matrix (including
Codex Responses and every installed harness) is **deferred, not for now**. Prefer
deployment-specific `additional_drop_params` for known bad fields and narrowly declared
`allowed_openai_params` only after the provider accepts them. Reject a required capability that
would be dropped; never report a degraded call as full-featured success. The docs note that Claude
Code/Codex user agents trigger implicit dropping on some LiteLLM versions, including a 1.103–1.108
bug around explicit `drop_params: false`; pin and probe the production build.

[Provider-specific parameters](https://docs.litellm.ai/docs/completion/provider_specific_params) can
pass through model config or request bodies. Keep model/provider settings in the generated LiteLLM
row; allow request-time overrides only from trusted, scoped callers with a reviewed field allowlist.
Never rely on `drop_params` to remove arbitrary provider-specific fields such as `mcp_servers`; test
the actual Copilot rejection and strip or reject those fields explicitly at the owning boundary.

LiteLLM's [message sanitization](https://docs.litellm.ai/docs/completion/message_sanitization) uses
global `modify_params: true` in its Anthropic transformation: it may insert dummy tool results,
remove orphaned real results and replace empty messages. That can make a request provider-valid
while hiding a Pi journal/replay defect or changing the evidence the agent sees. Keep it disabled
for durable Pi conversations unless a matched test proves the exact transformed transcript is
recorded and an interrupted tool is never mistaken for a completed effect. Validate the Pi message
sequence before the model call, and fail/repair from the durable journal when tool IDs or results
disagree. For interactive CLI traffic, qualify sanitization separately with sampled before/after
receipts and an explicit operator-visible repair marker. The docs say the setting is global with no
per-request override, so isolate traffic by gateway instance if the required policies differ. Do not
turn it on globally as a generic fix for malformed durable history. Its documented Anthropic-only
application does not establish behavior for the `github_copilot/` provider path.

### Tool execution requirements (B03, B10, B11)

The [LiteLLM tool integration index](https://docs.litellm.ai/docs/guides/tools_integrations) mixes
distinct mechanisms. Ordinary function calling returns a tool request for Pi to execute and journal.
Provider web fetch/computer-use formats are passthrough, not proof that LiteLLM executes Fleet's
browser or shell. By contrast,
[web-search interception](https://docs.litellm.ai/docs/integrations/websearch_interception) executes
a search and another model call within one gateway request; the
[advisor tool](https://docs.litellm.ai/docs/completion/anthropic_advisor_tool) can also run hidden
subcalls. Maintain a per-tool registry naming the executor (Pi, provider or LiteLLM), authority,
side-effect class, idempotency key, receipt location, call count, billing and replay behavior. Keep
filesystem, shell, browser and task mutations under Pi Durable's fenced graph. Enable gateway
search/advice only with scoped read-only policy and end-to-end trace/cost receipts. Qualify native
web fetch, computer use, code interpreter and vector search for the actual provider and wire; reject
unsupported required tools.

The [streaming guide](https://docs.litellm.ai/docs/completion/stream) documents SDK and proxy
streaming; Fleet still proves its actual APIM→Buckle→LiteLLM→Pi path above. For structured worker
decisions, check
[native `response_format`/`json_schema` support](https://docs.litellm.ai/docs/completion/json_mode)
on the served deployment and validate the complete response against Fleet's versioned schema before
committing a command. Preserve and test
[reasoning content and signed thinking blocks](https://docs.litellm.ai/docs/reasoning_content) when
a later turn needs them; redact operator views without corrupting replay bytes. Cross-provider/key
fallback can drop encrypted reasoning. Record the served deployment and loss, then require a fresh
continuation instead of claiming identical reasoning state after failover.

[Batching and fastest-response races](https://docs.litellm.ai/docs/completion/batching) may help
read-only classification and offline evaluation. Do not race tool-using worker generations or treat
losing responses as free or effectless. Attribute each candidate's call ID, cost and cancellation;
only one selected generation may enter Pi's durable tool path.

### Routing requirements (B05, B08)

Use LiteLLM's [deployment router](https://docs.litellm.ai/docs/routing) for balancing, cooldown,
retries and allowed fallback within the selected model policy. Auto Router/Kev chooses a tier;
Worker host owns external work admission and durable wake, while Pi schedules mission tasks. Specify
one attempt budget across Pi, Buckle and LiteLLM so stacked retries cannot multiply silently. Record
model group, deployment, key/team policy, reason, latency, spend, stream state and outcome per
attempt. Test real proxy errors; LiteLLM strips `mock_testing_*` flags on proxy requests. The
[fallback guide](https://docs.litellm.ai/docs/proxy/reliability) says cross-provider/key fallback
can remove encrypted reasoning, including on a broken stream. Permit fallback before a streamed
answer is exposed; on a post-chunk failure, mark the visible generation interrupted and create a new
journaled attempt. Fault-inject both boundaries on the pinned version; never splice two deployments
into one Pi turn.

The [timeout guide](https://docs.litellm.ai/docs/proxy/timeout) distinguishes whole-call `timeout`,
first-chunk `stream_timeout` and native Messages/Responses next-chunk `request_timeout`. Pin each
against APIM/Buckle/Pi total and idle deadlines, including retries and long quiet periods.
Heartbeats do not reset provider deadlines.

Apply [per-key/team router settings](https://docs.litellm.ai/docs/proxy/keys_teams_router_settings)
deliberately: key overrides team, which overrides global. Reconcile effective policy at request
time. A worker key, human BYOC request or
[client-supplied fallback](https://docs.litellm.ai/docs/proxy/client_side_fallbacks) must not select
an unapproved model, credential, region or deadline. Version and audit
[fallback management](https://docs.litellm.ai/docs/proxy/fallback_management) changes; its API
requires database-backed models and must not create drift from generated config. Treat
[tags](https://docs.litellm.ai/docs/proxy/tag_routing) as trusted policy labels, not caller-provided
authority. With [wildcard routing](https://docs.litellm.ai/docs/wildcard_routing), virtual-key model
grants, price metadata and served-model verification remain mandatory.

Qualify [provider/model/tag budgets](https://docs.litellm.ai/docs/proxy/provider_budget_routing)
against actual priced usage and Redis health before hard enforcement; unknown or zero-priced Copilot
usage does not prove free capacity.
[Routing groups](https://docs.litellm.ai/docs/proxy/ui/routing_groups) need one reviewed policy
source despite dashboard editing. Scope
[health-check routing](https://docs.litellm.ai/docs/proxy/health_check_routing) to eligible groups
and account for probe traffic, transient 429/408 policy and cooldown intervals. Cache-aware routing
targets Kubernetes headless-service pods and does not directly fit today's one-vendor Copilot
engine; qualify ordinary session affinity separately if multiple deployments emerge. Request
prioritization is beta/test-only, routing plugins are evolving, and
[Fusion is unreleased](https://docs.litellm.ai/docs/fusion). Record explicit deferred dispositions
for these features.

### Engine configuration requirements (B02)

The [production guide](https://docs.litellm.ai/docs/proxy/prod) requires measured sizing, bounded
database connections, migration control, Redis coordination for multiple instances and deliberate
background-job ownership. A serving worker is not Fleet's durable worker: `LITELLM_JOB_ROLE`
controls gateway maintenance jobs, which can otherwise register once per Uvicorn process. Prove
exactly one intended owner for resets/pruning/exports, and budget CPU, memory and Postgres
connections per actual gateway worker. Keep the production image pinned by digest, perform
migrations once, back up the DB and encryption salt, and verify rollback against stored keys/models.
The [Docker quickstart](https://docs.litellm.ai/docs/proxy/docker_quick_start) is a local setup
pattern, not the deployed Azure sizing/HA receipt.

LiteLLM's own production guide says a database connection outage may admit requests under a
restricted `INTERNAL_USER` identity and `/health/readiness` can still return 200. Buckle must deny
remote worker and coordinator requests whose required virtual-key grants cannot be verified; an
outside-process probe must exercise a scoped positive and negative request, not infer authorization
health from readiness. Test DB loss, Redis loss and return-to-service at every replica, including
revocation and budget behavior.

The [configuration guides](https://docs.litellm.ai/docs/proxy/configuration/overview) support YAML,
UI and Management API. Choose one owner per model and setting; export and diff live effective config
against the approved source. In v1.103.0+, YAML-declared general/router/LiteLLM/env settings
override UI/API changes, while a database model with the same name as a YAML model adds another
deployment. Earlier versions have different precedence. Pin the version, verify each replica's
loaded config and test the served deployment after any change. The
[Management API](https://docs.litellm.ai/docs/proxy/configuration/api) should mint/revoke scoped
keys and teams through a separate admin credential; never give that credential to the worker.
Preserve `LITELLM_SALT_KEY` for database credential recovery; changing it makes stored provider
credentials unreadable.

The [published benchmarks](https://docs.litellm.ai/docs/benchmarks) use mock models and specific
multi-pod configurations. They establish neither this Azure deployment's capacity nor Pi's
productive throughput. Measure Fleet's own end-to-end first token, quiet interval, tool turn,
fallback, runner outcome and spend at target concurrency with the pinned image, APIM, Buckle, real
provider and worker present.

### Engine capability requirements (B06–B12)

LiteLLM can select deployments within a model group, retry, cool down failed deployments and fall
back to another allowed group. It also offers virtual keys, user/team roles, model access, budgets
and rate limits, spend logs, Prometheus metrics, tracing, caching and guardrails. Qualify these
against the pinned deployed version and both BYOC and engine-held paths; an available feature is not
necessarily enabled. References: [router](https://docs.litellm.ai/docs/router/learn/strategies),
[reliability](https://docs.litellm.ai/docs/router/learn/reliability),
[access](https://docs.litellm.ai/docs/proxy/access_management/overview),
[budgets](https://docs.litellm.ai/docs/proxy/users),
[metrics](https://docs.litellm.ai/docs/proxy/prometheus), and
[spend logs](https://docs.litellm.ai/docs/proxy/cost_tracking).

The following is a historical configuration observation; B00 must refresh it before B02 changes
deployment. The checked-in Azure Compose file starts one LiteLLM engine container. Its config has
one deployment row per Copilot model name, with no second backend in any model group; it declares no
`router_settings`, Prometheus callback, database, cache or guardrails. Compose declares no
`DATABASE_URL` or dedicated metrics port. Buckle's engine collector can pull `/metrics` and
aggregate spend only when those engine faces are configured and reachable; it keeps at most 500 raw
series, so it is an overview rather than a per-runner evidence store. The shared Buckle default
points `engine.url` at container-local `127.0.0.1:4000`; the Azure override does not change it to
`engine:4000`. Verify the resolved live over-layer before asserting that this engine leg and
telemetry work. The default `keys.engine` also points at `/etc/buckle/keys/engine.key`, but Azure
Compose does not mount that path and the Azure mint step only creates principal/session keys in
`/state/keys`. Reconcile the engine master-key contract without copying the Copilot PAT into Buckle,
and prove an authenticated engine call through the resolved URL.

Buckle's streamed outcome banks zero tokens in its live tracker because it does not buffer SSE. That
zero means **unmeasured at this surface**, not a zero-token call. The older Fleet Buckle package has
a separate per-request usage ledger; this extracted Azure Buckle does not expose the same ledger by
implication.

The following feature requirements belong to B06–B12; backlog dependencies control execution order:

#### Evidence and attribution (B01, B06)

Prove the live image digest, resolved engine URL, LiteLLM version, metrics and spend endpoints, and
whether a database and callback are enabled. Add a tested correlation seam from runner UUID, writer
epoch, Pi conversation, submission and model request to W3C `traceparent` and Buckle/LiteLLM request
IDs. Store the mapping in a durable receipt or versioned read model, never as high-cardinality
Prometheus labels. Keep Pi outcome, Buckle traffic decision and LiteLLM deployment attempts as
distinct evidence with source and missing-data markers. A retry or federated hop is not a new user
request. Verify a call and its retry join one Pi submission.

#### Metrics (B06)

Enable and privately scrape LiteLLM's Prometheus callback only after checking the pinned image's
metric set. Use request/provider latency, streaming time to first token, in-flight/queue time,
deployment failures, cooldowns, fallbacks and token counts to diagnose stalls. Scrape from a trusted
collector; Buckle's 500-series overview is not the full histogram feed. Bound labels and retain no
prompt/response content in metrics. For per-runner spend, qualify paginated spend logs and the price
map with a database; `$0` without a known price is unknown spend. Throughput does not prove
productive Pi work.

#### Auto Router requirements (B08)

Configure LiteLLM's [Auto Router](https://docs.litellm.ai/docs/auto_router/) as a virtual model
whose tiers refer to deployed engine rows. It selects a model group per request; deployment
balancing is a separate router decision. Several Copilot models suffice even with one vendor. The
VMSS Kev classifier is supplied by standalone fleet-belt, which selects a pinned checkpoint after
resource, p95 latency and held-out tier-quality tests. Kev-0.6B is a candidate for the observed
small VMSS; compare it with current Kev-0.8B and resize/dedicate capacity if needed. Belt runs the
selected model on a private origin and independently probes real `/v1/systemone` inference. Register
**Kev** as a self-hosted decision deployment, then point Auto Router at that deployment. Current
LiteLLM docs use `classifier_type: oss_classifier` with
`opensource_classifier_config.deployment_name`; prove the pinned build accepts Kev's exact System
One wire or add a narrow adapter. Do not wrap Kev as a chat `classifier_type: llm` model or label it
as another provider. Pin and verify a LiteLLM build that supports the needed native decision routes;
observed VMSS v1.103.0 predates the documented v1.104.2+ route availability. Pin image, tier map,
default model, timeout, circuit breaker and fallback in generated config. Use
[fleet-belt deployment gates](../../fleet-belt/plan.md) for its qualified image, private endpoint
and inference-readiness receipt. Do not confuse Belt IDs with Buckle B IDs.

Preserve the anchored `.prefer` contract above: `must=a,b` tries only those models in order, and
`prefer=a,b` tries them before defaults. A router alias is eligible only when explicitly listed as a
candidate or chosen in the documented default list; do not reinterpret an existing list as a broad
tier set. A `must` list of concrete models bypasses Auto Router. Migrate the owner-controlled
defaults to the router alias only after matched qualification, with a named rollback to the former
ordered defaults. The current worker builds one Pi provider model at boot from `pick.model`
(`src/worker.session.ts`): verify its router alias, served-model receipt, context limits, tools, SSE
and usage before switching traffic. Keep one Kev routing decision per turn across the Pi
guest/Worker host/Buckle/LiteLLM boundary. BYOC pass-through is a direct endpoint and does not
inherit Auto Router behavior.

Put retries and cooldowns in one layer with a bounded attempt budget: LiteLLM documents two
same-group retries by default, and the worker currently configures Pi with `maxRetries: 3`.
Cross-group fallbacks must honor pins, grants, context, tool/SSE support, quality and credential
boundaries. Never silently continue a tool stream on a different model after content was delivered.
Record requested alias, classifier tier, served model, attempts and fallback cause under the Pi
submission. Compare held-out Fleet tasks and a bounded shadow evaluation before switching production
traffic; measure solver success, classifier cost, total spend and p95 latency, not tier-choice
agreement alone. [Evaluation guide](https://docs.litellm.ai/docs/auto_router/evaluate).

#### Access requirements (B04)

Compare Buckle principal scopes and APIM/Entra identity with LiteLLM virtual keys, teams, roles,
access groups, JWT mapping and audit logs. Choose one authoritative model access policy and test
owner-engine and human BYOC paths, including revocation and denial. A second independent grant must
not widen access silently. Virtual-key spend and database-backed budgets need Postgres and an
identity mapping. Decide which layer owns each rate limit and budget, including fail behavior,
before replacing Buckle admission controls.

#### Optional capability requirements (B12)

Exact-response and provider prompt caching are different; semantic response caching needs a
dedicated quality study before agent use. LiteLLM guardrails do not replace Pi tool permission,
GitHub effect or test gates. OTel can expose model timing and fallback spans; qualify content
capture and identity redaction before export. Each feature gets a bounded Absurd work item, matched
on/off test, rollback and source-of-truth decision.

#### Required remote protocols (B10, B11, W18)

**Use LiteLLM's agent gateway capabilities for remote workers.** The
[A2A gateway](https://docs.litellm.ai/docs/a2a) is a strong fit for an external agent-to-agent entry
point: agent cards, `message/send`, `message/stream`, task lookup/cancel/resubscribe, key/team
grants and trace attribution are already defined. LiteLLM routes to an upstream A2A agent; it does
not turn today's Pi worker or coordinator into one. Implement a thin A2A endpoint for remote-worker
invocation, mapping A2A task IDs to runner UUID, Pi task/submission ID and writer epoch; commands
call the Worker host admission/cancel API. Register that endpoint in LiteLLM and let Buckle carry
identity, scopes, correlation and streaming through to it. Pin protocol version 1.0 or 0.3 and test
task persistence, reconnect, cancellation, auth and duplicate delivery. The LiteLLM kill-switch
webhook is an admin action, not a replacement for Fleet's durable cancellation and epoch fencing.

The [MCP gateway](https://docs.litellm.ai/docs/mcp) will expose selected coordinator/worker tools
through native key/team access and Streamable HTTP, SSE or stdio. Use Buckle as the authenticated
ingress and pass LiteLLM's protocol through without inventing another tool registry. Inventory tool
authority and side effects first; privileged actions still need Fleet's idempotency, receipts and
writer-epoch checks. MCP SSE, model-token SSE and the operator SSE feed have separate contracts.
Keep stdio disabled unless a specific trusted tool needs it.

#### Required Lens deployment (B07)

**Enable [LiteLLM Lens](https://docs.litellm.ai/docs/proxy/lens) in production.** The
[deployment guide](https://docs.litellm.ai/docs/proxy/lens/deployment) says Lens is a separate
service with ClickHouse; a LiteLLM sidebar connection alone does not instrument agents. Plan and
deploy a pinned Lens image, private ClickHouse storage, backups, retention, service tokens and
restricted UI access. Connect it to the LiteLLM dashboard, then export Pi worker and coordinator
OpenTelemetry traces directly to Lens with runner/conversation/submission/epoch correlation and a
tracing key. Configure the analysis model before scheduled investigations. Prove a stored tool/model
trace, a linked LiteLLM spend record and a redacted investigation in a test environment before
production traffic. Preserve Fleet's Pi journal and effect receipts as authority; Lens traces and
findings are diagnostic evidence, with explicit missing data and sampling. Its docs label it early
access, so qualify release support, image compatibility, security and rollback before rollout.

### Deployment acceptance requirements (B02, B05, B14, B15)

Use LiteLLM's [production guide](https://docs.litellm.ai/docs/proxy/prod) to qualify the pinned
build. Set production mode, restrict the master key to admin use, configure trusted proxy ranges,
disable verbose/content logging and keep structured logs. Resolve actual overlays before changing
the engine URL or service credential. B02 owns the generator and generated config; feature lanes
send it reviewed config inputs.

Before enabling DB-backed keys, size connection pools across all processes, batch spend writes, run
one migration owner, preserve the salt key and prove backups. Choose fail-closed versus the
documented private-network DB-outage behavior explicitly and test it. Add Redis when multiple
processes need shared cooldown/rate/affinity state; assign one owner to shared maintenance jobs.
Verify license and version gates for each enabled feature, especially pass-through authentication
and advanced identity.

B14 accepts the baseline needed for W17. B15 accepts all required features and actor paths on pinned
images: Auto Router, Kev decision catalog, scoped keys/budgets, metrics/spend evidence, Lens traces,
MCP and A2A. B12 records dispositions only for optional features. Rehearse engine restart, DB/Redis
loss, failed upgrade and rollback with in-flight Pi work; external probes remain health authority.
Record availability, first-token latency, stream completion, fallback/rate-limit rate, spend lag and
unknown usage under representative Fleet load. A successful boot or UI screenshot cannot close these
acceptance cases.

### Runtime wiring by actor (B01, B04, B10, B11)

At W16/W17 the model route uses a catalog-qualified concrete model under existing must/prefer
policy. B08 later enables the explicitly eligible Auto Router alias. The table describes that final
route; it does not make B08 or E-BELT a prerequisite of the first working runner.

| Actor                    | Intended path                                                                                                                                                                                                                                                                       | Authority and proof                                                                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote Pi worker         | Pi OpenAI chat adapter → scoped Buckle runner route → LiteLLM Auto Router alias → selected Copilot model; tool calls stay in the Pi durable task.                                                                                                                                   | Worker carries runner UUID/writer epoch/Pi submission IDs. `must` concrete pins bypass Auto Router; eligible defaults ride it. Journal the selected model, classifier/fallback and usage; Lens receives Pi model/tool spans.                       |
| Supervisor / coordinator | Pi root agent supervises its own workflow and children inside Gondolin; Worker host authorizes runner creation, placement and fencing. Its inference rides Buckle → LiteLLM. A2A is an external invocation face for remote workers, while MCP presents scoped coordinator commands. | Pi journal owns workflow state; placement metadata stays outside. A2A task ID maps to runner UUID, Pi task/submission ID and writer epoch; MCP mutations call the existing command API with idempotency and audit. Neither gateway schedules work. |
| Buckle                   | Authenticate principal and lane, enforce its ingress policy, preserve trace headers and stream bodies, then route model, A2A and MCP requests to the one LiteLLM gateway.                                                                                                           | Expose only approved paths/scopes. Map each caller to a scoped LiteLLM identity/key and prove revocation and grants at both layers; never use the engine master key as a shared runtime credential.                                                |
| LiteLLM                  | Auto Router chooses model tier; deployment router handles retries/fallbacks; virtual keys/teams gate models, agents and tools; Prometheus/spend/OTel supply model evidence; A2A and MCP gateway expose native protocols.                                                            | One pinned deployment/config source, one explicit owner per policy, observed served model and attempt ledger, failure tests and rollback. Lens is a separate trace service.                                                                        |
| Local CLI session        | **Not for now:** Fleet's existing Vercel-skills-based installer remains the setup path for detected clients and harnesses. Current proof is Claude Code through Buckle/LiteLLM to a Copilot seat, plus a bounded GitHub Copilot harness Buckle-route probe.                         | Do not infer a governed model route from detection, skill installation or hook wiring. Broader Pi/Codex/other CLI setup, Auto Router opt-in, MCP wiring and Lens exports wait for a later client-integration pass.                                 |

**First adapter work, before gateway activation.** Extracted Azure `fleet-buckle/src/main.ts` sends
unknown paths through `engine.passthrough`, and `proxy/buckle.proxy.passthrough.ts` replaces every
caller credential with the configured engine token. This can stream native `/a2a/*` and `/mcp/*`
bytes, but LiteLLM would see one identity. Split model, A2A, MCP and admin permissions; define an
audited principal/lane → scoped LiteLLM virtual-key mapping with mint, rotation and revocation.
Preserve trace context and the required LiteLLM auth headers without forwarding caller secrets to
unrelated backends. Fail closed on an unmapped caller or unqualified path. Prove that neither an
ordinary model key nor a BYOC PAT reaches admin faces. Do not import the old Fleet monorepo Buckle
or Suspenders MCP runtime into these extracted services. Implement a narrow, scoped MCP adapter
against the Worker host command/read API, then register it behind LiteLLM grants. Preserve any
proven behavior through reviewed tests in its owning repo.

**Local CLI integration — deferred.** Keep the existing Vercel-skills-based installer separate. The
only current proof is one Claude Code and one GitHub Copilot harness request through Buckle/LiteLLM,
with model, tool, SSE, identity and version receipts. Broader client install, MCP wiring and Lens
export use the
[LiteLLM client setup matrix](https://docs.litellm.ai/docs/proxy/client_setup/overview) in a later
pass.

### Gateway retirement inventory (B00, B13)

B00 records caller, state owner and keep/move/delete disposition for every reachable gateway module,
entry point, deployment and test. B13 already removed `src/agents/`; do not recreate it or
follow the stale inventory's deletion recipe. B15 removes unused Pi dependencies and proves gateway
regressions against the qualified forward Worker path.
[Worker migration requirements](../../fleet-worker/plan.md#migration-inventory-requirements-w00-w08-w19)
own seed/template/image facts.

## Deferred human BYOC requirements (D01)

- Complete the owner pilot through APIM with a real Entra access token, the owner personal Copilot
  PAT, verified identity, denied anonymous/spoofed callers and an actual Messages/tools/SSE round
  trip. The registered client ID and audience are operator inputs.
- Before broad multi-user access, prove two real users have isolated catalog, policy, usage and
  logs; test renewal and revocation. Do not let a human BYOC failure fall back to the engine-held
  worker credential.
- Prove one GitHub Copilot CLI route through Buckle/LiteLLM; keep broad client-installer work
  deferred.

Historical pilot receipts remain in
[Git history](https://github.com/klh/fleet-buckle/blob/5ee51b6/tasks/deprecated.md). They do not
define current dispatch order.

## Deferred federation requirements (D02)

- inventory actual H100 hosts, operating systems, model servers, network paths, capacity, and
  separate microVM-capable hosts. Do not assume an inference GPU host can run the selected VM
  backend.
- deploy one on premises Buckle plus model engine, then configure it as a downstream peer of the
  Azure Buckle with explicit grants. Buckle uses live catalog provenance to choose the peer; LiteLLM
  at that peer owns model deployments, aliases, balancing, and fallback. Do not copy provider model
  lists into Buckle settings. Retain the VMSS Copilot route during commissioning.
- from a real developer CLI, prove one Azure URL lists an entitled H100 model, serves a chat and
  stream, and returns the actual served-by chain and usage. Test a denied principal, 429, and peer
  loss. Give on premises Pi sessions scoped access to the same model path. Verify that a Copilot PAT
  is never forwarded to the H100 peer or another provider when the CLI switches models in the same
  session.
- prove the actual Entra/network edge and human-to-principal mapping before broad developer access.
  Record human, CLI session, autonomous runner, and model usage distinctly; no raw personal seat
  token belongs in a tool guest.
- maintain a compatibility matrix for the deployed LiteLLM version: chat, streaming, tools,
  responses and other endpoint families actually offered by each model engine. Buckle forwards
  supported calls and policy-bearing context without narrowing LiteLLM's feature surface;
  unsupported provider features fail honestly at the engine.

**AC**: a developer reaches an H100-served model through Azure Buckle; a Pi runner reaches its
entitled route; both expose actual model/host usage. Denied access and a lost peer fail visibly.
Docker federation tests remain green, but the on premises route must have its own live receipt.
