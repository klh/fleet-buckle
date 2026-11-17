# Rollout plan — Azure Buckle, Fleet workers, and on premises models

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
| **Job**                        | Use only for LiteLLM maintenance jobs or archived pilot terminology; do not use it for a runner, Pi task or host work item.                                                                                          |

## Active work (2026-11-17)

1. [ ] Launch one Gondolin guest containing a Pi Durable runner on the VMSS; replace its process and resume the same UUID and journal without a GitHub issue or SSH per task.
2. [ ] Build Absurd/Postgres work queues pulled by eligible Pi supervisor guests, finite host-operation queues, the direct Pi runner API and recovery directory; then delete the old Supervisor queue, issue poller and lane-spawn workflow. Pi owns mission tasks and children inside Gondolin. Worker owns admission policy, placement, fencing and wake delivery.
3. [ ] Publish authenticated Pi snapshots, commands and resumable watches to the separate GUI API; prove accepted, busy, rejected, replayed and subtree-stop outcomes.
4. [ ] Qualify Buckle/LiteLLM access, model streams, routing, metrics, Auto Router with Belt-served Kev, Lens, scoped MCP and A2A. Each enabled feature needs a live receipt and rollback.
5. [ ] Prove failure recovery across Worker, Buckle, LiteLLM and GUI, including effect replay, writer fencing, stream gaps and an eight-runner VMSS interruption.

**Deferred separate gates:** Entra/APIM owner pilot and Copilot CLI proof await their own acceptance; krun, on-prem H100 federation, zram, settings pin and Mac upstream are separate backlog. Volatile issue and deployment status must be read from the live repositories before dispatch. Completed pilot receipts are in [deprecated.md](deprecated.md).

## Gateway and model guardrails

- Buckle authenticates and attributes callers, preserves supported model
  wires and streaming, federates catalogs and routes to LiteLLM. It never
  launches a Pi runner or owns its task graph. LiteLLM resolves provider
  deployments, retries and allowed fallbacks; the Pi runner chooses its
  requested model under its own `must`/`prefer` policy.
- A concrete `must=` model list is an owner pin. `prefer=` tries listed
  models in order before approved defaults. Only an explicitly eligible
  router alias may enter Auto Router. Qualify the served model, tools,
  context, SSE and usage before selecting that alias.
- Human BYOC and isolated engine-held owner-worker credentials remain
  distinct. An auth failure cannot switch modes. Upstream PATs and keys
  must not enter the runner image, Pi journal, trace or work brief.
  Future virtual-key and secret custody requires per-user isolation,
  revocation and a tested migration.
- The checked-in Azure Compose pins LiteLLM by digest. Qualify each
  upgrade against catalog, auth, Messages, tools, SSE and rollback;
  verify the running digest and effective configuration separately.
- Do not impose an arbitrary `max_tokens` cap to mask a model capacity
  error. Pick a model that serves the runner's actual ask shape. Explicit
  runner budgets and loop limits still protect a continuing mission.
- The first acceptance path is Worker API launch and submission on the
  VMSS. Git is for code and charter revision, not work intake. A future
  multi-host controller may place runners without replacing Pi's task
  scheduler. The current issue queue and spawn loop are retirement
  targets once callers use the direct Pi path.

## Entra/APIM and human BYOC follow-up

- [ ] Complete the owner pilot through APIM with a real Entra access token, the owner personal Copilot PAT, verified identity, denied anonymous/spoofed callers and an actual Messages/tools/SSE round trip. The registered client ID and audience are operator inputs.
- [ ] Before broad multi-user access, prove two real users have isolated catalog, policy, usage and logs; test renewal and revocation. Do not let a human BYOC failure fall back to the engine-held worker credential.
- [ ] Prove one GitHub Copilot CLI route through Buckle/LiteLLM; keep broad client-installer work deferred.

The original P0 pilot procedure and completed receipts are in [deprecated.md](deprecated.md).

## P3 — federate the Azure endpoint with on premises H100 service

- **P3.1** inventory actual H100 hosts, operating systems, model
  servers, network paths, capacity, and separate microVM-capable hosts.
  Do not assume an inference GPU host can run the selected VM backend.
- **P3.2** deploy one on premises Buckle plus model engine, then
  configure it as a downstream peer of the Azure Buckle with explicit
  grants. Buckle uses live catalog provenance to choose the peer;
  LiteLLM at that peer owns model deployments, aliases, balancing, and
  fallback. Do not copy provider model lists into Buckle settings.
  Retain the VMSS Copilot route during commissioning.
- **P3.3** from a real developer CLI, prove one Azure URL lists an
  entitled H100 model, serves a chat and stream, and returns the actual
  served-by chain and usage. Test a denied principal, 429, and peer loss.
  Give on premises Pi sessions scoped access to the same model path.
  Verify that a Copilot PAT is never forwarded to the H100 peer or another
  provider when the CLI switches models in the same session.
- **P3.4** prove the actual Entra/network edge and human-to-principal
  mapping before broad developer access. Record human, CLI session,
  autonomous runner, and model usage distinctly; no raw personal seat
  token belongs in a tool guest.
- **P3.5** maintain a compatibility matrix for the deployed LiteLLM
  version: chat, streaming, tools, responses and other endpoint families
  actually offered by each model engine. Buckle forwards supported
  calls and policy-bearing context without narrowing LiteLLM's feature
  surface; unsupported provider features fail honestly at the engine.

**AC**: a developer reaches an H100-served model through Azure Buckle;
a Pi runner reaches its entitled route; both expose actual model/host usage.
Denied access and a lost peer fail visibly. Docker federation tests remain
green, but the on premises route must have its own live receipt.

## P6 — one Pi Durable runner lifecycle and an operator UI (planned 2026-11-17)

P6 builds the forward architecture: a continuing Pi Durable runner inside
a Gondolin guest, with host placement/recovery and Buckle model access.
Prove one journal and writer, durable effect reconciliation, background
child ownership, operator commands, failure recovery and rollback. First
pin a reviewed upstream Pi commit or release with the needed signal and
parked-tool APIs. Design references include upstream examples
[`22-subagent-background`](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/22-subagent-background.ts),
[`32-tests-after-edits`](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/32-tests-after-edits.ts),
[`34-submit-in-commit`](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/34-submit-in-commit.ts),
[`40-tool-waits-for-webhook`](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/40-tool-waits-for-webhook.ts),
and the [Cloudflare wake/activity example](https://github.com/earendil-works/pi-durable-cloudflare).
Verify the examples against the pinned forward API in the guest image;
copying the Cloudflare or React host is not part of this design.

### Binding Pi Durable runner architecture

The **configured Pi Durable root agent is the runner and supervisor**. A
reviewed runner image, Markdown charter revision, resolved variables and
instance settings are its inception inputs. Pi inside the Gondolin guest
opens durable storage and the Harness root; `pi.agent` holds the
per-conversation model, tools, extensions, instructions and working
directory. Pi records charter provenance in a typed document; Worker host
DB records inception inputs, image digest and grants for recovery.
The image is reusable and Gondolin is the execution substrate.

The LLM interprets the charter as an ongoing mission. Granted Pi extensions
let it do work, create specialist conversations, fork context, commit owned
tasks, establish a recurring loop, wait, review and stop children. The
charter is not a compiled issue workflow. An answered turn can leave the
agent parked; a durable task or hook carries each standing commitment.
The pinned forward Pi API supplies `onYield`, `afterRun`, task waits,
typed signals and parked tools. The host arms wakes from `onWake`/`wake()`
and directs the guest to call `resume()`. Eligible supervisor guests
pull external work items from Absurd queues through a reviewed adapter.
The host does not choose the next Pi task or interpret the charter.

Same-Harness children inherit their parent's agent until configured for
their role. Foreground abort leaves background children alive; a whole
runner stop must cross that boundary and reconcile independently placed
children. A separately placed child has its own journal and a parent-owned
durable admission/result/cancel task. A2A is for independently running
remote agents; MCP is a scoped tool boundary. Neither protocol replaces
Pi's native local child graph.

Worker owns authorized launch, placement, fencing, external source ingress,
storage and thin Pi command/read transport. Pi owns conversation history,
commits, task graph, child ownership, waits, usage and workflow decisions.
Buckle and LiteLLM own model access and routing; GUI owns presentation.
An external effect needs a stable idempotency key and Pi receipt. SQLite
with default `synchronous = NORMAL` proves process-crash continuity; host
loss needs separate storage and sync qualification. The target Pi guest
must reopen the same journal under one fenced writer after replacement.
The Worker host uses Absurd/Postgres for the runner directory, admission
rows, external work queues and finite placement/wake/reconciliation
operations. Pi storage retains execution steps: transcript, submissions,
checkpoints, waits, children, effects and typed documents. After a full
crash, Worker hosts pull recovery operations, restore Gondolin guests and
Pi inside each guest reopens its journal and calls `resume()`. Eligible
supervisor guests resume pulling external work; repeated delivery uses a
stable Pi `requestId`. The host never rebuilds Pi tasks from Postgres rows.
These are separate commit domains, reconciled by explicit IDs and
receipts. The first Absurd claim pins its runner UUID and Pi conversation
before submission. A retry on another supervisor must inspect that
pinned Pi journal and cannot submit the item to a new root merely by
reusing a conversation-scoped `requestId`.

### Binding Pi Durable source and API map

The [Worker Absurd binding](../../fleet-worker/plan.md#host-db-and-absurd-binding)
defines external work-item pull, host operations and recovery. The
[Worker Pi Durable surface map](../../fleet-worker/plan.md#binding-pi-durable-surface-map)
maps **every online README heading and every public Pi interface** to the
Gondolin guest, Worker host and Buckle. It is the single source map for
both plans. Buckle implements only its model-route, identity, streaming,
catalog and telemetry boundaries; it does not create Pi tasks, maintain
a runner journal or interpret charters. Pin and qualify the forward Pi
API with signals and parked tools before implementation.

### Streaming contracts and evidence

There are two different streams. Model requests use the provider's
Anthropic/OpenAI SSE dialect through APIM, Buckle and LiteLLM to Pi AI;
preserve event order, tool deltas, terminal markers and in-band errors.
Pi AI emits typed `start`, delta, `done` and `error` events from the
provider stream; its `partial` object is mutable live state, not an
event-time snapshot. Consume deltas immediately and never retain
`partial` by reference as a historical event. A transport EOF without
the dialect's successful terminal is an interrupted generation.
The operator feed is a GUI API-owned, authenticated SSE projection of
Worker-exposed Pi `watch()` and `watchTaskGraph()` plus Pi task and external
admission receipts. Pi watches are local state subscriptions, **not** an HTTP SSE
server or a replay log. The upstream Cloudflare example uses WebSockets;
Fleet's read-only browser feed may use SSE without copying that host.

For the operator feed, expose a versioned snapshot and a same-origin SSE
endpoint with typed `snapshot`, `runner`, `task_graph`, `conversation`,
`receipt`, `gap` and `stream_end` events. Each event carries schema
version, runner UUID, writer epoch and a monotonically ordered cursor scoped
to the journal/read-model generation. Authenticate before subscribing;
authorize every runner on fan-out. Use same-origin session credentials with
`EventSource`, or an authorized `fetch` stream if bearer headers are
required; never place credentials in the SSE URL. The Worker adapter attaches the Pi watch before taking the snapshot;
the GUI API publishes buffered changes after its cursor to avoid a
snapshot/subscribe race. A bounded per-client queue must coalesce
replaceable views; on overflow or journal generation change emit `gap`
and force a fresh snapshot. `Last-Event-ID` may resume only within a
retained, matching-generation ring; otherwise return a snapshot and
page missing transcript entries with Pi's `ConversationTranscript` /
`watch(..., transcript.resume)` semantics. Pi watch callbacks can fold
commits and replace a large pending diff with a full view, so do not
promise one UI event per internal commit. Stop watches on disconnect,
abort and harness close; reconnect to the reopened harness. Keep HTTP
commands and health as ordinary request/response APIs. SSE comment
heartbeats maintain transport only; they never count as model progress,
productive worker activity or a lease renewal.

Fleet's Buckle code already adds final-egress SSE heartbeats and checks
protocol terminals, but prior long-quiet/APIM acceptance was unproved.
Verify every deployed hop with a representative quiet stream, tool-use
stream, in-band failure, client disconnect and total-deadline case.
Record first byte, quiet interval, last model event, terminal receipt
and cancellation at APIM, Azure Buckle, LiteLLM and Pi AI. A heartbeat
on the last hop cannot repair an earlier upstream idle timeout; configure
and test each hop's buffering and limits separately. The operator feed
gets its own reconnect/overflow/crash tests and must show a truthful
`reconciling` or `interrupted` state until the snapshot catches up.

LiteLLM's [SDK exception mapping](https://docs.litellm.ai/docs/exception_mapping)
normalizes provider failures to OpenAI exception classes. Fleet's
HTTP clients instead need the
[gateway error contract](https://docs.litellm.ai/docs/proxy/error_reference):
preserve status, `error` shape, `x-litellm-call-id`, retry headers and
the request/served-model IDs across Buckle. Classify gateway auth,
budget, cooldown and model-access errors separately from provider
throttling, timeout and content/context rejection. A 429 is not always
retryable: budget exhaustion needs a policy decision, while rate limits
honor `retry-after`; 400/401/403 generally require request or access
repair. A failed fallback chain may return the **first** group's status,
so bank every attempted deployment from gateway logs, not status alone.
An error after first SSE content arrives keeps HTTP 200 and appears as
an in-band `error` event; Pi must mark that generation interrupted and
must not settle it as a successful completion. Test both first-chunk
JSON errors and mid-stream SSE errors through APIM→Buckle→LiteLLM→Pi.
Do not assume A2A, MCP or management errors share the LLM error envelope.

### Request compatibility and conversation integrity

The checked-in LiteLLM generator emits global `drop_params: true` for
Copilot seats. Per the
[drop-params guide](https://docs.litellm.ai/docs/completion/drop_params),
that silently discards unsupported OpenAI parameters; it does not prove
the requested tool, reasoning, JSON or cache behavior actually reached
the selected model. For now, prove the Pi worker chat route and a small
Claude Code → Buckle → LiteLLM → Copilot seat tool/SSE round trip. Check
the outbound provider shape and returned behavior for those paths.
The broader model × client-wire × feature matrix (including Codex
Responses and every installed harness) is **deferred, not for now**.
Prefer deployment-specific `additional_drop_params` for known bad
fields and narrowly declared `allowed_openai_params` only after the
provider accepts them. Reject a required capability that would be
dropped; never report a degraded call as full-featured success. The
docs note that Claude Code/Codex user agents trigger implicit dropping
on some LiteLLM versions, including a 1.103–1.108 bug around explicit
`drop_params: false`; pin and probe the production build.

[Provider-specific parameters](https://docs.litellm.ai/docs/completion/provider_specific_params)
can pass through model config or request bodies. Keep model/provider
settings in the generated LiteLLM row; allow request-time overrides
only from trusted, scoped callers with a reviewed field allowlist.
Never rely on `drop_params` to remove arbitrary provider-specific
fields such as `mcp_servers`; test the actual Copilot rejection and
strip or reject those fields explicitly at the owning boundary.

LiteLLM's [message sanitization](https://docs.litellm.ai/docs/completion/message_sanitization)
uses global `modify_params: true` in its Anthropic transformation: it
may insert dummy tool results, remove orphaned real results and replace
empty messages. That can make a request provider-valid while hiding a
Pi journal/replay defect or changing the evidence the agent sees.
Keep it disabled for durable Pi conversations unless a matched test
proves the exact transformed transcript is recorded and an interrupted
tool is never mistaken for a completed effect. Validate the Pi message
sequence before the model call, and fail/repair from the durable
journal when tool IDs or results disagree. For interactive CLI traffic,
qualify sanitization separately with sampled before/after receipts and
an explicit operator-visible repair marker. The docs say the setting
is global with no per-request override, so isolate traffic by gateway
instance if the required policies differ. Do not turn it on globally
as a generic fix for malformed durable history. Its documented
Anthropic-only application does not establish behavior for the
`github_copilot/` provider path.

### Tool execution and response-shape ownership

The [LiteLLM tool integration index](https://docs.litellm.ai/docs/guides/tools_integrations)
mixes distinct mechanisms. Ordinary function calling returns a tool
request for Pi to execute and journal. Provider web fetch/computer-use
formats are passthrough, not proof that LiteLLM executes Fleet's
browser or shell. By contrast,
[web-search interception](https://docs.litellm.ai/docs/integrations/websearch_interception)
executes a search and another model call within one gateway request;
the [advisor tool](https://docs.litellm.ai/docs/completion/anthropic_advisor_tool)
can also run hidden subcalls. Maintain a per-tool registry naming the
executor (Pi, provider or LiteLLM), authority, side-effect class,
idempotency key, receipt location, call count, billing and replay
behavior. Keep filesystem, shell, browser and task mutations under Pi
Durable's fenced graph. Enable gateway search/advice only with scoped
read-only policy and end-to-end trace/cost receipts. Qualify native
web fetch, computer use, code interpreter and vector search for the
actual provider and wire; reject unsupported required tools.

The [streaming guide](https://docs.litellm.ai/docs/completion/stream)
documents SDK and proxy streaming; Fleet still proves its actual
APIM→Buckle→LiteLLM→Pi path above. For structured worker decisions,
check [native `response_format`/`json_schema` support](https://docs.litellm.ai/docs/completion/json_mode)
on the served deployment and validate the complete response against
Fleet's versioned schema before committing a command. Preserve and
test [reasoning content and signed thinking blocks](https://docs.litellm.ai/docs/reasoning_content)
when a later turn needs them; redact operator views without corrupting
replay bytes. Cross-provider/key fallback can drop encrypted reasoning.
Record the served deployment and loss, then require a fresh continuation
instead of claiming identical reasoning state after failover.

[Batching and fastest-response races](https://docs.litellm.ai/docs/completion/batching)
may help read-only classification and offline evaluation. Do not race
tool-using worker generations or treat losing responses as free or
effectless. Attribute each candidate's call ID, cost and cancellation;
only one selected generation may enter Pi's durable tool path.

### Router policy and production boundaries

Use LiteLLM's [deployment router](https://docs.litellm.ai/docs/routing)
for balancing, cooldown, retries and allowed fallback within the
selected model policy. Auto Router/Kev chooses a tier; Worker host owns
external work admission and durable wake, while Pi schedules mission tasks. Specify one attempt
budget across Pi, Buckle and LiteLLM so stacked retries cannot multiply
silently. Record model group, deployment, key/team policy, reason,
latency, spend, stream state and outcome per attempt. Test real proxy
errors; LiteLLM strips `mock_testing_*` flags on proxy requests. The
[fallback guide](https://docs.litellm.ai/docs/proxy/reliability) says
cross-provider/key fallback can remove encrypted reasoning, including
on a broken stream. Permit fallback before a streamed answer is exposed;
on a post-chunk failure, mark the visible generation interrupted and
create a new journaled attempt. Fault-inject both boundaries on the
pinned version; never splice two deployments into one Pi turn.

The [timeout guide](https://docs.litellm.ai/docs/proxy/timeout)
distinguishes whole-call `timeout`, first-chunk `stream_timeout` and
native Messages/Responses next-chunk `request_timeout`. Pin each
against APIM/Buckle/Pi total and idle deadlines, including retries and
long quiet periods. Heartbeats do not reset provider deadlines.

Apply [per-key/team router settings](https://docs.litellm.ai/docs/proxy/keys_teams_router_settings)
deliberately: key overrides team, which overrides global. Reconcile
effective policy at request time. A worker key, human BYOC request or
[client-supplied fallback](https://docs.litellm.ai/docs/proxy/client_side_fallbacks)
must not select an unapproved model, credential, region or deadline.
Version and audit [fallback management](https://docs.litellm.ai/docs/proxy/fallback_management)
changes; its API requires database-backed models and must not create
drift from generated config. Treat [tags](https://docs.litellm.ai/docs/proxy/tag_routing)
as trusted policy labels, not caller-provided authority. With
[wildcard routing](https://docs.litellm.ai/docs/wildcard_routing),
virtual-key model grants, price metadata and served-model verification
remain mandatory.

Qualify [provider/model/tag budgets](https://docs.litellm.ai/docs/proxy/provider_budget_routing)
against actual priced usage and Redis health before hard enforcement;
unknown or zero-priced Copilot usage does not prove free capacity.
[Routing groups](https://docs.litellm.ai/docs/proxy/ui/routing_groups)
need one reviewed policy source despite dashboard editing. Scope
[health-check routing](https://docs.litellm.ai/docs/proxy/health_check_routing)
to eligible groups and account for probe traffic, transient 429/408
policy and cooldown intervals. Cache-aware routing targets Kubernetes
headless-service pods and does not directly fit today's one-vendor
Copilot engine; qualify ordinary session affinity separately if multiple
deployments emerge. Request prioritization is beta/test-only, routing
plugins are evolving, and [Fusion is unreleased](https://docs.litellm.ai/docs/fusion).
Record explicit deferred dispositions for these features.

### LiteLLM deployment and configuration control

The [production guide](https://docs.litellm.ai/docs/proxy/prod)
requires measured sizing, bounded database connections, migration
control, Redis coordination for multiple instances and deliberate
background-job ownership. A serving worker is not Fleet's durable
worker: `LITELLM_JOB_ROLE` controls gateway maintenance jobs, which can
otherwise register once per Uvicorn process. Prove exactly one intended
owner for resets/pruning/exports, and budget CPU, memory and Postgres
connections per actual gateway worker. Keep the production image pinned
by digest, perform migrations once, back up the DB and encryption salt,
and verify rollback against stored keys/models. The
[Docker quickstart](https://docs.litellm.ai/docs/proxy/docker_quick_start)
is a local setup pattern, not the deployed Azure sizing/HA receipt.

LiteLLM's own production guide says a database connection outage may
admit requests under a restricted `INTERNAL_USER` identity and
`/health/readiness` can still return 200. Buckle must deny remote
worker and coordinator requests whose required virtual-key grants
cannot be verified; an outside-process probe must exercise a scoped
positive and negative request, not infer authorization health from
readiness. Test DB loss, Redis loss and return-to-service at every
replica, including revocation and budget behavior.

The [configuration guides](https://docs.litellm.ai/docs/proxy/configuration/overview)
support YAML, UI and Management API. Choose one owner per model and
setting; export and diff live effective config against the approved
source. In v1.103.0+, YAML-declared general/router/LiteLLM/env settings
override UI/API changes, while a database model with the same name as
a YAML model adds another deployment. Earlier versions have different
precedence. Pin the version, verify each replica's loaded config and
test the served deployment after any change. The
[Management API](https://docs.litellm.ai/docs/proxy/configuration/api)
should mint/revoke scoped keys and teams through a separate admin
credential; never give that credential to the worker. Preserve
`LITELLM_SALT_KEY` for database credential recovery; changing it makes
stored provider credentials unreadable.

The [published benchmarks](https://docs.litellm.ai/docs/benchmarks)
use mock models and specific multi-pod configurations. They establish
neither this Azure deployment's capacity nor Pi's productive throughput.
Measure Fleet's own end-to-end first token, quiet interval, tool turn,
fallback, runner outcome and spend at target concurrency with the
pinned image, APIM, Buckle, real provider and worker present.

### LiteLLM capability and telemetry adoption

LiteLLM can select deployments within a model group, retry, cool down
failed deployments and fall back to another allowed group. It also
offers virtual keys, user/team roles, model access, budgets and rate
limits, spend logs, Prometheus metrics, tracing, caching and guardrails.
Qualify these against the pinned deployed version and both BYOC and
engine-held paths; an available feature is not necessarily enabled.
References: [router](https://docs.litellm.ai/docs/router/learn/strategies),
[reliability](https://docs.litellm.ai/docs/router/learn/reliability),
[access](https://docs.litellm.ai/docs/proxy/access_management/overview),
[budgets](https://docs.litellm.ai/docs/proxy/users),
[metrics](https://docs.litellm.ai/docs/proxy/prometheus), and
[spend logs](https://docs.litellm.ai/docs/proxy/cost_tracking).

The checked-in Azure Compose file starts one LiteLLM engine container.
Its config has one deployment row per Copilot model name, with no
second backend in any model group; it declares no `router_settings`, Prometheus callback,
database, cache or guardrails. Compose declares no `DATABASE_URL` or
dedicated metrics port. Buckle's engine collector can pull `/metrics`
and aggregate spend only when those engine faces are configured and
reachable; it keeps at most 500 raw series, so it is an overview rather
than a per-runner evidence store. The shared Buckle default points
`engine.url` at container-local `127.0.0.1:4000`; the Azure override
does not change it to `engine:4000`. Verify the resolved live over-layer
before asserting that this engine leg and telemetry work. The default
`keys.engine` also points at `/etc/buckle/keys/engine.key`, but Azure
Compose does not mount that path and the Azure mint step only creates
principal/session keys in `/state/keys`. Reconcile the engine master-key
contract without copying the Copilot PAT into Buckle, and prove an
authenticated engine call through the resolved URL.

Buckle's streamed outcome banks zero tokens in its live tracker because
it does not buffer SSE. That zero means **unmeasured at this surface**,
not a zero-token call. The older Fleet Buckle package has a separate
per-request usage ledger; this extracted Azure Buckle does not expose
the same ledger by implication.

Adopt features in dependency order, with one policy owner per decision:

1. **Evidence and attribution.** Prove the live image digest, resolved
   engine URL, LiteLLM version, metrics and spend endpoints, and whether
   a database and callback are enabled. Add a tested correlation seam
   from runner UUID, writer epoch, Pi conversation, submission and model request to
   W3C `traceparent` and Buckle/LiteLLM request IDs. Store the mapping
   in a durable receipt or versioned read model, never as high-cardinality
   Prometheus labels. Keep Pi outcome, Buckle traffic decision and
   LiteLLM deployment attempts as distinct evidence with source and
   missing-data markers. A retry or federated hop is not a new user
   request. Verify a call and its retry join one Pi submission.
2. **Metrics.** Enable and privately scrape LiteLLM's Prometheus
   callback only after checking the pinned image's metric set. Use
   request/provider latency, streaming time to first token,
   in-flight/queue time, deployment failures, cooldowns, fallbacks and
   token counts to diagnose stalls. Scrape from a trusted collector;
   Buckle's 500-series overview is not the full histogram feed. Bound
   labels and retain no prompt/response content in metrics. For per-runner
   spend, qualify paginated spend logs and the price map with a
   database; `$0` without a known price is unknown spend. Throughput
   does not prove productive Pi work.
3. **Auto Router is the production model selector for eligible Pi turns.**
   Configure LiteLLM's [Auto Router](https://docs.litellm.ai/docs/auto_router/)
   as a virtual model whose tiers refer to deployed engine rows. It selects
   a model group per request; deployment balancing is a separate router
   decision. Several Copilot models suffice even with one vendor. The
   VMSS Kev classifier is supplied by standalone fleet-belt, which
   selects a pinned checkpoint after resource, p95 latency and held-out
   tier-quality tests. Kev-0.6B is a candidate for the observed small VMSS;
   compare it with current Kev-0.8B and resize/dedicate capacity if needed.
   Belt runs the selected model on a private origin and independently probes real
   `/v1/systemone` inference. Register **Kev** as a self-hosted
   decision deployment, then point Auto Router at that deployment.
   Current LiteLLM docs use `classifier_type: oss_classifier` with
   `opensource_classifier_config.deployment_name`; prove the pinned
   build accepts Kev's exact System One wire or add a narrow adapter.
   Do not wrap Kev as a chat `classifier_type: llm` model or label it
   as another provider. Pin and verify a LiteLLM build that
   supports the needed native decision routes; observed VMSS v1.103.0
   predates the documented v1.104.2+ route availability. Pin image, tier
   map, default model, timeout, circuit breaker and fallback in generated
   config. Reference fleet-belt root `plan.md` B7–B11 for deployment gates.

   Preserve the anchored `.prefer` contract above: `must=a,b` tries only
   those models in order, and `prefer=a,b` tries them before defaults.
   A router alias is eligible only when explicitly listed as a candidate
   or chosen in the documented default list; do not reinterpret an
   existing list as a broad tier set. A `must` list of concrete models
   bypasses Auto Router. Migrate the owner-controlled defaults to the
   router alias only after matched qualification, with a named rollback
   to the former ordered defaults. The current worker builds one Pi provider model
   at boot from `pick.model` (`src/worker.session.ts`): verify its router
   alias, served-model receipt, context limits, tools, SSE and usage before
   switching traffic. Keep one Kev routing decision per turn across the
   Pi guest/Worker host/Buckle/LiteLLM boundary. BYOC pass-through is a direct
   endpoint and does not inherit Auto Router behavior.

   Put retries and cooldowns in one layer with a bounded attempt budget:
   LiteLLM documents two same-group retries by default, and the worker
   currently configures Pi with `maxRetries: 3`. Cross-group fallbacks
   must honor pins, grants, context, tool/SSE support, quality and
   credential boundaries. Never silently continue a tool stream on a
   different model after content was delivered. Record requested alias,
   classifier tier, served model, attempts and fallback cause under the
   Pi submission. Compare held-out Fleet tasks and a bounded shadow
   evaluation before switching production traffic; measure solver
   success, classifier cost, total spend and p95 latency, not tier-choice
   agreement alone. [Evaluation guide](https://docs.litellm.ai/docs/auto_router/evaluate).

4. **Access consolidation.** Compare Buckle principal scopes and
   APIM/Entra identity with LiteLLM virtual keys, teams, roles, access
   groups, JWT mapping and audit logs. Choose one authoritative model
   access policy and test owner-engine and human BYOC paths, including
   revocation and denial. A second independent grant must not widen
   access silently. Virtual-key spend and database-backed budgets need
   Postgres and an identity mapping. Decide which layer owns each rate
   limit and budget, including fail behavior, before replacing Buckle
   admission controls.
5. **Optional features.** Exact-response and provider prompt caching
   are different; semantic response caching needs a dedicated quality
   study before agent use. LiteLLM guardrails do not replace Pi tool
   permission, GitHub effect or test gates. OTel can expose model
   timing and fallback spans; qualify content capture and identity
   redaction before export. Each feature gets a bounded issue,
   matched on/off test, rollback and source-of-truth decision.

**Use LiteLLM's agent gateway capabilities for remote workers.**
The [A2A gateway](https://docs.litellm.ai/docs/a2a) is a strong fit
for an external agent-to-agent entry point: agent cards, `message/send`,
`message/stream`, task lookup/cancel/resubscribe, key/team grants and
trace attribution are already defined. LiteLLM routes to an upstream
A2A agent; it does not turn today's Pi worker or coordinator into one.
Implement a thin A2A endpoint for remote-worker invocation,
mapping A2A task IDs to runner UUID, Pi task/submission ID and writer epoch;
commands call the Worker host admission/cancel API. Register that endpoint in LiteLLM
and let Buckle carry identity, scopes, correlation and streaming through
to it. Pin protocol version 1.0 or 0.3 and test task persistence,
reconnect, cancellation, auth and duplicate delivery. The LiteLLM
kill-switch webhook is an admin action, not a replacement for Fleet's
durable cancellation and epoch fencing.

The [MCP gateway](https://docs.litellm.ai/docs/mcp) will expose selected
coordinator/worker tools through native key/team access and Streamable
HTTP, SSE or stdio. Use Buckle as the authenticated ingress and pass
LiteLLM's protocol through without inventing another tool registry.
Inventory tool authority and side effects first; privileged actions
still need Fleet's idempotency, receipts and writer-epoch checks. MCP
SSE, model-token SSE and the operator SSE feed have separate contracts.
Keep stdio disabled unless a specific trusted tool needs it.

**Enable [LiteLLM Lens](https://docs.litellm.ai/docs/proxy/lens) in
production.** The [deployment guide](https://docs.litellm.ai/docs/proxy/lens/deployment)
says Lens is a separate service with ClickHouse; a LiteLLM sidebar
connection alone does not instrument agents. Plan and deploy a pinned
Lens image, private ClickHouse storage, backups, retention, service
tokens and restricted UI access. Connect it to the LiteLLM dashboard,
then export Pi worker and coordinator OpenTelemetry traces directly
to Lens with runner/conversation/submission/epoch correlation and a tracing
key. Configure the analysis model before scheduled investigations.
Prove a stored tool/model trace, a linked LiteLLM spend record and a
redacted investigation in a test environment before production
traffic. Preserve Fleet's Pi journal and effect receipts as authority;
Lens traces and findings are diagnostic evidence, with explicit missing
data and sampling. Its docs label it early access, so qualify release
support, image compatibility, security and rollback before rollout.

**Production change order for the current one-vendor deployment:**

Use LiteLLM's [production guide](https://docs.litellm.ai/docs/proxy/prod)
as a release gate. Set `LITELLM_MODE=PRODUCTION`, keep the master key in
a secret manager, configure `trusted_proxy_ranges` for the actual ingress,
disable verbose/content logging and use structured logs. Pin explicit
request and stream timeouts to the Buckle/APIM/Pi deadline budget; do
not copy the guide's sample timeout without an end-to-end stream test.
If adding the database, keep `LITELLM_SALT_KEY` stable, size its
connection pool for the maximum replica/worker count, batch spend
writes, back it up and run migrations once before serving the new
image. Decide fail-closed versus LiteLLM's restricted DB-outage mode
with an explicit threat and outage test; the latter is documented only
for private-network deployments. On multiple replicas, give LiteLLM's
shared scheduled jobs one owner and use Redis for routing state.
Production metrics need retention, alert ownership and a tested
recovery path, not just a reachable `/metrics` endpoint.

- Repair the checked-in Buckle→engine address and service credential
  mapping, keep the engine API off public ingress, and prove both
  engine-held and BYOC calls through Buckle. The engine-held service
  credential should be a scoped LiteLLM virtual key once DB-backed
  keys are qualified; the master key stays in the engine/admin plane.
  Resolve the live overlay before changing files, and preserve the
  working route during a canary. Pin the qualified image digest and
  retain the previous image/config for rollback.
- Change the source generator
  `tools/src/buckle.gen-engine-config.ts`, then regenerate the
  checked-in LiteLLM config; never hand-edit its generated model rows.
  Enable the Prometheus callback on the qualified image and scrape
  privately on the existing engine port first. Add explicit retry
  settings and a cross-layer attempt ceiling after failure tests.
  Generate the Auto Router row with deployed tiers and a qualified
  self-hosted Kev System One classifier deployment whose private origin and
  readiness come from fleet-belt's pinned VMSS release. The generator
  must resolve the Belt service address and scoped credential without
  hardcoding either in Git; setup fails closed if the external inference
  probe is not ready. Verify the pinned LiteLLM version accepts the
  generated config and calls real Kev before enabling the alias.
  Validate the router alias through Pi, `must` and
  `.prefer` policy, classifier outage fallback and held-out task quality
  before canary traffic. Record the selected model and router decision.
  Route fallback only among separately qualified Copilot models; with
  one backend per group, least-busy/latency routing has no useful
  deployment choice yet. Keep mid-stream continuation disabled until
  it passes tool, JSON and crash tests.
- Deploy backed-up PostgreSQL for per-worker access, enforced budgets
  and durable spend logs before enabling LiteLLM virtual
  keys and team policy. Test migration, DB outage, key revocation,
  spend lag and rollback. Add Redis when multiple LiteLLM processes or
  replicas need shared cooldown/rate/affinity state; one process does
  not need it solely for routing. Validate feature availability and
  licensing on the pinned image, especially pass-through auth and
  advanced identity/admin options.
- Define SLOs and alerts for availability, first-token latency, stream
  completion, rate-limit/fallback rate, spend-log lag and unknown usage.
  Deploy and connect Lens plus ClickHouse as a separately monitored
  service, instrument Pi and coordinator traces, and verify retention,
  redaction, spend join, backups and trace access before enabling
  investigations. Qualify native A2A/MCP gateway calls through Buckle
  with real remote-worker and coordinator use cases.
  An outside-process probe remains the health authority. Rehearse
  engine restart, DB/Redis loss, a failed image upgrade and rollback
  with in-flight Pi work before claiming production readiness.

### [ ] Buckle and LiteLLM production integration

(Buckle/engine, worker and coordinator items with separate owners;
after the direct Pi runner and its read/command contract are proven). Apply the production change order above
as executable work items, each with config source, version gate,
rollback, security review and an end-to-end receipt:

- Auto Router is live for eligible worker turns with a qualified Kev
  classifier, measured tier policy, safe failure fallback, hard-pin
  preservation and recorded requested/served models. Prove normal,
  classifier-down, model-down, tool/SSE and retry-budget cases.
- Belt's VMSS Kev release is pinned and independently inference-probed.
  Buckle advertises its live `decision` capability through the
  authenticated catalog and exposes an authorized System One/Decisions
  path if supported by the pinned LiteLLM build. Test entitled and
  denied callers, stale health, error mapping and trace linkage; never
  advertise Kev as a chat model. The implementation and Playwright
  tests belong in this repo, with Belt owning only the serving side.
- LiteLLM Prometheus metrics, spend/usage records, fallback logs and
  Buckle correlation reach the production collector/read model.
  Unknown usage remains unknown; alerts and retention have owners.
- Gateway/provider error classes, retry headers and call IDs survive
  Buckle; Pi distinguishes pre-stream JSON failure from HTTP-200
  in-band SSE error. Failure injection proves no false success,
  unbounded retry or lost fallback-attempt evidence.
- The Pi worker and Claude Code/Copilot proof records which required
  parameters are forwarded, dropped or rejected, with a real tool/SSE
  round trip. Durable Pi tool history passes without global
  sanitization masking a missing result. Full client compatibility
  coverage and optional CLI repair are **deferred, not for now**.
- Every enabled tool path names its actual executor and has a scoped
  authority, Pi journal or gateway trace receipt, cost attribution and
  replay rule. A gateway-executed search/advisor subcall cannot hide an
  effect from Pi's task state; structured output is schema-validated
  before a worker command, and signed thinking survives continuation.
- Router policies are measured on the pinned image: one attempt budget
  across hops, explicit pre/post-first-chunk fallback behavior, bounded
  total/first/next-chunk deadlines, effective key/team overrides,
  trusted tags and model grants, and live deployment/cost receipts.
- Gateway production proof covers DB/Redis loss, scoped deny behavior,
  background-job ownership, configuration precedence and duplicate
  model names, salt/DB backup and rollback, and representative Fleet
  throughput rather than vendor mock-model benchmark numbers.
- Database-backed virtual keys, team/model/agent/MCP grants, budgets,
  revocation and audit are active for remote workers. Test denial,
  quota exhaustion and DB failure without widening access.
- The A2A worker endpoint is registered in LiteLLM and reachable
  through Buckle; one remote caller proves discovery, send, stream,
  task lookup, resubscribe, cancel and duplicate delivery against the
  same fenced Pi runner. The scoped MCP coordinator/worker tools are
  registered in LiteLLM and exercised through Buckle, including
  rejected unauthorized calls and one idempotent side effect.
- Lens and ClickHouse run in production; Pi worker/coordinator
  traces, model calls, tool spans and spend join under stable IDs.
  Prove trace access, redaction, retention, backup and one useful
  investigation. A working sidebar without agent traces fails exit.
- Cache modes, guardrails, extra router strategies and advanced
  identity features receive explicit measured dispositions: enable
  each useful feature with policy, owner and rollback, or record why
  it would degrade correctness, privacy or latency. No silent skip.

**Exit:** every required feature and actor path in this step has a live
receipt on the pinned image and a rollback path; no feature is closed
by a config row, successful boot or dashboard screenshot alone.

#### Runtime wiring by actor

| Actor                    | Intended path                                                                                                                                                                                                                                                                       | Authority and proof                                                                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote Pi worker         | Pi OpenAI chat adapter → scoped Buckle runner route → LiteLLM Auto Router alias → selected Copilot model; tool calls stay in the Pi durable task.                                                                                                                                   | Worker carries runner UUID/writer epoch/Pi submission IDs. `must` concrete pins bypass Auto Router; eligible defaults ride it. Journal the selected model, classifier/fallback and usage; Lens receives Pi model/tool spans.                       |
| Supervisor / coordinator | Pi root agent supervises its own workflow and children inside Gondolin; Worker host authorizes runner creation, placement and fencing. Its inference rides Buckle → LiteLLM. A2A is an external invocation face for remote workers, while MCP presents scoped coordinator commands. | Pi journal owns workflow state; placement metadata stays outside. A2A task ID maps to runner UUID, Pi task/submission ID and writer epoch; MCP mutations call the existing command API with idempotency and audit. Neither gateway schedules work. |
| Buckle                   | Authenticate principal and lane, enforce its ingress policy, preserve trace headers and stream bodies, then route model, A2A and MCP requests to the one LiteLLM gateway.                                                                                                           | Expose only approved paths/scopes. Map each caller to a scoped LiteLLM identity/key and prove revocation and grants at both layers; never use the engine master key as a shared runtime credential.                                                |
| LiteLLM                  | Auto Router chooses model tier; deployment router handles retries/fallbacks; virtual keys/teams gate models, agents and tools; Prometheus/spend/OTel supply model evidence; A2A and MCP gateway expose native protocols.                                                            | One pinned deployment/config source, one explicit owner per policy, observed served model and attempt ledger, failure tests and rollback. Lens is a separate trace service.                                                                        |
| Local CLI session        | **Not for now:** Fleet's existing Vercel-skills-based installer remains the setup path for detected clients and harnesses. Current proof is Claude Code through Buckle/LiteLLM to a Copilot seat, plus a bounded GitHub Copilot harness Buckle-route probe.                         | Do not infer a governed model route from detection, skill installation or hook wiring. Broader Pi/Codex/other CLI setup, Auto Router opt-in, MCP wiring and Lens exports wait for a later client-integration pass.                                 |

**First adapter work, before gateway activation.** Extracted Azure
`fleet-buckle/src/main.ts` sends unknown paths through
`engine.passthrough`, and `proxy/buckle.proxy.passthrough.ts` replaces
every caller credential with the configured engine token. This can
stream native `/a2a/*` and `/mcp/*` bytes, but LiteLLM would see one
identity. Split model, A2A, MCP and admin permissions; define an
audited principal/lane → scoped LiteLLM virtual-key mapping with mint,
rotation and revocation. Preserve trace context and the required
LiteLLM auth headers without forwarding caller secrets to unrelated
backends. Fail closed on an unmapped caller or unqualified path. Prove
that neither an ordinary model key nor a BYOC PAT reaches admin faces.
Do not import the old Fleet monorepo Buckle or Suspenders MCP runtime into
these extracted services. Implement a narrow, scoped MCP adapter against
the Worker host command/read API, then register it behind LiteLLM grants.
Preserve any proven behavior through reviewed tests in its owning repo.

**Local CLI integration — deferred.** Keep the existing Vercel-skills-based
installer separate. The only current proof is one Claude Code and one
GitHub Copilot harness request through Buckle/LiteLLM, with model, tool,
SSE, identity and version receipts. Broader client install, MCP wiring and
Lens export use the [LiteLLM client setup matrix](https://docs.litellm.ai/docs/proxy/client_setup/overview)
in a later pass.

### Buckle and seed refactor inventory (verified 2026-11-17)

Before code changes, review **all** Buckle surfaces (`access/`,
`admin/`, `admission/`, `agents/`, `catalog/`, `context/`, `events/`,
`federation/`, `metrics/`, `proxy/`, `schemas/`, `trace/`, main entry
points, deployment and tests). For each, record its caller, state owner,
runner relevance and keep/move/retire decision. Verify real import and
route reachability and seed image provenance; do not infer production
use from a file's presence. Preserve working gateway behavior while
removing duplicate agent runtime code behind explicit contract
tests and rollout gates.

- `fleet-buckle/src/agents/` contains copied Pi runtime/seed/writer code.
  Inventory reachability, then delete it after the direct Pi guest path
  passes. Author needed runner contracts in Worker; Buckle keeps identity,
  routing, scoped access, traffic and telemetry. No second manifest parser.
- `fleet-worker/seed/template.md` is a GitHub issue/PR charter; its
  `{{token}}` expansion happens at ask time. The named templates in
  `seed/templates/` are one-issue specialist briefs and repeat Git
  instructions. Separate ongoing root charters from specialist briefs;
  render and record the root charter once per runner revision, validate
  every variable, and centralize Git policy in common instructions.
- The published `tool-seed` supplies Bun, Playwright and CLI tools and
  carries no Pi runtime. Historical `pi-durable-workers/seed/` contains
  a distinct runtime seed and tool-seed recipe. Verify the deployed
  digest before deleting or reusing either. The final runner image owns
  Pi Durable, extensions and the journal mount; seed digest/policy is
  an admission check, not another agent supervisor.

### Binding P6 refactor order and GUI contract

1. Audit current Buckle, Worker, seeds, image digests and live API
   consumers. Record keep/move/retire decisions and a compatibility map.
2. Define Absurd queues for external work pulled by eligible supervisor
   guests, host operations pulled by Worker hosts, and the runner directory.
   Admit work atomically with its Postgres row; use a stable Pi `requestId`
   to reconcile the two commit domains.
3. Define runner inception: reviewed image + charter revision + resolved
   variables + instance settings → stable UUID, Pi root and journal.
   Treat GitHub issue handling as one optional charter/capability.
4. Move workflow decisions, recurring waits, child graph and state into
   Pi root conversations, tasks, extensions and documents. The Absurd
   guest adapter only pulls eligible external work and submits it to Pi;
   Worker hosts handle admission policy, placement, fencing and wakes.
5. Replace the old Supervisor queue, polling and lane spawning with the
   direct Pi guest path, then delete those runtime modules. Preserve external
   effect idempotency and rollback.
6. Prove persistence, one writer, wake and crash recovery across guest
   replacement using the pinned forward Pi API with signals and parked tools.
7. Publish typed Pi snapshots, transcript and task-graph watches,
   usage/effect receipts and acknowledged commands to the separate
   GUI API. The GUI's `plan.md` refactor section governs its design:
   root-first Runners, full-page workbench, Tasks & waits projection,
   Charters editor, Home alerts and Gateway/Lens links. The GUI owns
   its own filtering, SSE fan-out and page state, never Pi workflow.
8. Run hermetic end-to-end and failure-injection gates before rollout:
   repeated source events, concurrent children, replay after effects,
   background subtree stop, spend cap, writer loss, snapshot gaps and
   100-runner UI load. Record image/package digests and rollback.
