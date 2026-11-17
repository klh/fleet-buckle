# Rollout plan — Azure Buckle, Fleet workers, and on premises models

## TODO index (2026-11-17)

- [x] P0 — PAT cycle LIVE on VMSS (issue→seat→PR, PRs #79–#112); BYOC URL-token lanes; Responses dialect f6ff9da live (gpt-6.1-terra 200); copilot-integration-id on both branches
- [x] P0 CLI verification — unmodified `claude` against the live lane URL (2.1.312, `wire ok`; receipt in P0.2c)
- [ ] P0 CLI verification — Copilot CLI against the lane URL; Entra/APIM leg remains part of P0.2
- [x] P0.2d owner-pilot login script — isolated package and 8 unit tests complete; receipt in P0.2d
- [ ] P0.2d live Entra GUI device-flow — BLOCKED on owner pasting Entra client ID (P0.2 APIM same blocker)
- [x] P1 — fleet-worker extraction (f8073fb; version matrix docs/worker-moved.md; rollback worker:e72086d)
- [x] P2.1–P2.3 executor axis — qemu-TCG/kvm guest (worker-gondolin image; guest kill/requeue/fresh-fence receipts; supervisor split cc1fb0e); same-conversation recovery remains P6
- [x] P2.4 — local Docker Desktop runner (7016770+4858518; PRs #92/#94 receipts)
- [ ] P2 krun executor — parked (aborts x86_64 in gondolin 0.14.0; alpine guest has no bun)
- [ ] P3 — H100 federation — parked (m04268)
- [x] P4 pilot receipts — 8-way concurrent (PRs #103–#110), parent/child split (PR #52), run-key revocation (PR #50), stale-lease refusal (d3584bd), docs/RECOVERY.md; P6 tracks stronger durability claims
- [x] P5 first slice — matched trials solo/concurrent/split run + docs/TRIALS.md (full BLAM deliberately not ported — owner directive)
- [ ] ChatGPT review fixes (13 findings, 2026-11-17) — IN PROGRESS: #1 catch-all auth gated (code+tests), #2–#13 queued
- [ ] GUI — ChatGPT draft awaited against tasks/gui-brief.md (uniform layer-registry face)
- [ ] zram on VMSS (m02251) · tracked-settings pin (m02917) · azure-buckle-as-Mac-upstream (m00957)
- [ ] t-shirt store templatization — owner-queued, awaiting brief
- [ ] P6 — one Pi Durable job lifecycle, wake and task-graph projections, and a thin operator UI; ordered plan at the end of this file

Implementation status: the architecture is agreed; dispatch begins with
the current-chain characterization in
[`implementation-contract.md`](implementation-contract.md). That contract
defines repository ownership, bounded lane briefs, unresolved credential
bindings, and the boundary guard required before multiple feature lanes.
This roadmap does not authorize one lane to build all of P0–P5.
`docs/target-architecture.md` is superseded design history.

## Anchored owner directives (2026-11-16 — binding until superseded here)

1. **Workers self-pick their model via `.prefer` semantics.** No single
   hard-pinned lane model. A startup file (hardcoded for now) typically
   lists `hub=` and `prefer=`. Parsing follows the fleet `.prefer`
   vocabulary: `must=` / `prefer=` / `can=` accept comma-separated models
   tried **in order of listing**; `hub=` / `hub-url=` accept
   comma-separated buckle endpoints, first working wins. The worker
   probes buckle's catalog, takes the first model that round-trips a
   representative ask, and works there.
   - `prefer=a,b` — ordered soft list; if NONE are available/working,
     fall back to a baked-in list of DEFAULTS and try those in order.
   - `must=a,b` — ordered hard list; if none work, the worker **errors
     out** (refuses to run on a wrong model).
   - `tag=` / `color=` — identification keys (label the worker in logs/
     dashboards); no routing effect.
2. **Worker auth topology**: pilot workers act as the owner and call
   Buckle through the authenticated deployment boundary. The operator's
   bootstrap supplies admission credentials; Buckle is not a new login
   or credential-issuing service. Worker pilot engine-held credentials
   are a separate mode from human BYOC, as specified below. Endpoint
   fallback uses only configured, authorized Buckle endpoints preserving
   the same identity/grant contract; never direct-provider bypass.
3. **PAT custody has two explicit modes.** Humans supply their own PAT
   by URL or Bearer; Buckle relays it transiently. The isolated owner-worker
   pilot may instead provision the owner's PAT only at its LiteLLM engine;
   Buckle gets an engine key, never a mounted worker PAT. A human BYOC
   request must never fall back to that owner-worker credential.
4. **Keep LiteLLM current through qualified upgrades.** Test the latest
   candidate against catalog, both auth modes, Messages, tools and SSE;
   then deploy that exact image digest and retain the previous digest.
   Never deploy a moving `latest` tag or auto-upgrade outside this check.
   LiteLLM owns provider parameter translation; record concrete failures.
   comment from pi: the rule needs teeth — compose.azure.yaml still pins `litellm:latest` (review #13). Propose: add a check-laws rule refusing floating tags (`:latest`, bare names) in deploy/ compose files, and pin the proven digest (1.103.0, live on the VMSS) in the same landing. Retained previous digest = the docker-save fallback path already proven twice.
5. **Later, not now**: launching workers from GUI / CLI / MCP-skill, and a
   job-placement ledger in Suspenders remembering what runs where.
   Hardcoded startup file until then; Buckle's request/usage ledger is
   separate and does not acquire scheduling or job-state responsibilities.
6. **No max_tokens or limits on worker asks (for now)** — proven root
   cause 2026-11-16: the copilot seat 422s when input + default
   completion allowance exceeds the SKU's budget (max_tokens=256 → 200,
   1024+ → 422 on the same ask). Resolution is model PICKING, not
   capping: the .prefer probe uses the heaviest ask shape and skips any
   model that cannot serve it unlimited. `.prefer` may still carry
   operational knobs — `max_tokens`, `max_loops`, and similar — where
   ABSENCE or 0 means no limits (the default stays unlimited).
7. **8-lane durable crash-recovery demo (goal state)**: fleet-worker's
   deployment launcher starts eight scoped Pi Durable workers on Azure;
   Suspenders owns their admission and recovery as that integration lands.
   Buckle serves their model traffic. Each lane has its own worktree,
   write scope, stable run ID and journal. Publishing to ACR is preparation;
   an explicit deployment/restart action is the failure event. The
   [recovery procedure](#eight-worker-recovery-procedure) below defines
   the P1.5→P3 demo and does not make Buckle a worker launcher.
8. **Prime the 8 workers from the pi-durable template examples to work
   on fleet itself** (fleet-buckle + fleet-worker once extracted): needs
   one new example.md variant for working on the fleet repos — the
   repoagent example pattern pointed at our own repos.
   comment from pi: LIVE as of 2026-11-17 09:26 — VMSS supervisor repointed to klh/fleet-worker, MAX_LANES=8, clones wiped, clean boot. Issue #1 (docs/ownership-map.md inventory = P6 step 1a) already minted; first wave is deliberately docs + bounded fixes, PRs merge owner-side only. Next waves carry the step-1 decomposition per the map the lanes produce. The example.md variant (children on fleet repos) stays queued until the loop is proven on flat tasks — one pivot at a time.

Architecture (owner ruling, 2026-11-16; Azure VMSS is the live target):

```mermaid
flowchart LR
  Dev[Developer CLIs and local controls] -->|Entra token plus optional personal Copilot PAT| APIM[Azure APIM front door]
  Login[Local Fleet login helper] -->|system-browser sign-in or device code| Entra
  Login -->|token cache and Claude settings| Dev
  Entra[Entra ID / AD] -->|token validation and access policy| APIM
  APIM -->|user token and verified identity| AZ[One Azure Buckle endpoint]
  AZ -->|federated catalog and requests| OB[On premises Buckles]
  OB --> Engines[Model engines] --> H100[H100 NVL hosts]
  AZ -->|context policy then proxy| Seat[VMSS LiteLLM engine: Copilot BYOC]
  Fleet[Fleet Suspenders: admission and recovery] --> Host[Approved runner host]
  Host --> Pi[Pi Durable parent and durable journal]
  Pi -->|models using owner identity in pilot| APIM
  Pi -->|bounded tools| Runner[Gondolin runner] --> VM[MicroVM guest]
  Pi -->|optional split| Child[Child Pi Durable session]
  Child -->|scoped tools| Runner
  Child -->|model requests| APIM
  Pi --> Result[PR, trace, usage, outcome] --> Fleet
  Result --> BLAM[BLAM matched trials] -->|measured seeds| Pi
  Knowledge[Decant and Fleet knowledge: later] -.-> Pi
```

- **fleet-buckle** = the identity-aware MITM around LiteLLM. It presents
  one Azure URL, fetches provider/peer model catalogs, federates to the
  correct Buckle + LiteLLM engine, tracks the authenticated user and
  request, and injects policy-bearing context where configured. It must
  preserve LiteLLM's supported API and provider capabilities rather than
  duplicate LiteLLM routing, model lists, limits, or per-user controls.
  Clients/workers choose the requested model; LiteLLM owns deployment
  resolution, aliases and provider routing. Worker `.prefer` behavior
  remains client policy and is being implemented in a separate lane.
- **Human identity and Copilot:** APIM validates the user's Entra ID/AD
  token and endpoint access. The user token and verified stable identity
  continue to Buckle; Buckle maps the user for federation, context policy,
  and observability. Prefer LiteLLM's native user/team mapping and controls
  when the deployed version and license support them; otherwise implement
  only the missing binding at Buckle. MS Copilot also needs each user's
  GitHub PAT. The client supplies it per request in a URL lane or Bearer
  header, as the client requires;
  it passes through to LiteLLM/Copilot without becoming shared server
  config. Prove isolation between users and deny direct APIM bypass.
  For the first rollout, trust the authenticated caller's supplied PAT;
  do not add an Entra-to-GitHub account binding requirement.
- **Pilot worker identity:** workers use the owner's authenticated identity
  for now, with distinct Fleet run IDs for attribution. BYOC workers relay
  an owner-supplied PAT; the explicitly isolated engine-held pilot keeps
  that PAT only at its dedicated LiteLLM engine. Record the mode in each
  receipt; never switch modes on auth failure. Dedicated identities are later;
  do not claim service identity or independent seat entitlement yet.
- **fleet-worker** (new repo) = Pi Durable parent/child runtime, OCI image,
  versioned capability seeds, journal, and whole-cycle e2e. A parent may
  work alone or split into scoped child sessions and integrate their patches.
- **Runner** = disposable microVMs for bounded tool operations. The Pi
  supervisor, model connection, and durable journal stay outside guests.
  Inference GPUs and microVM-capable runner hosts can be separate machines.
- **Fleet Suspenders** = admission, capacity, fencing, monitoring, recovery,
  and operator outcomes. Minimal integration is needed for the runner pilot;
  richer multi-host control follows. Developer CLI sessions have a separate
  local control face and are not automatically autonomous jobs.
- **BLAM** = isolated matched trials and evidence-backed seed promotion.
  Decant/Fleet knowledge is later. Absurd is only a possible future
  cross-host delivery experiment, not an extra work ledger in this rollout.

Current evidence: the plan records `/dev/kvm` on the 2-vCPU/7-GB VMSS;
recheck usable virtualization at deployment. `fleet-buckle` already has
Docker federation and Azure/BYOC tests plus an OCI worker prototype whose
Docker microworkers perform file checks. An engine-held-seat generator
experiment emitted 42 Copilot legs; that does not prove the VMSS serves
them or verify personal BYOC. Use it only for the isolated worker mode
after a live receipt; it is not the human credential configuration. The current
worker is not yet a microVM-hosted Pi supervisor. Label Docker Desktop,
emulated QEMU, VMSS, and real Xeon evidence separately. This plan records
intended work, not deployment state.

Known Phase 0 gaps: `test/e2e/buckle.e2e.azure.spec.ts` demonstrates OIDC
on the GUI `/api` seam while the model wire remains separately reachable.
`deploy/worker/worker.model.ts` sends a hardcoded body model to prove an
old lane pin. Neither is the desired Entra-bound, catalog-selected flow.

---

## P0 — personal-Copilot-PAT cycle on the live Azure VMSS — FIRST

Prove the human MITM + LiteLLM + Entra + client-supplied PAT chain and
one explicitly recorded worker auth mode before extraction. Engine-held
worker credentials never substitute for the human BYOC proof. P0's
owner-pilot exit is separate from its later org-readiness gate.
Select a model from the live catalog for each test;
do not add a Buckle model pin or a hardcoded catalog row.

- **P0.1** deploy the intended BYOC LiteLLM pass-through on the VMSS.
  Buckle fetches the live Copilot catalog with the caller's PAT, injects
  policy-bearing context where configured, then forwards the request
  through LiteLLM to Copilot. Keep LiteLLM responsible for model/provider
  capabilities; prove the relevant API faces and streaming survive both
  proxy hops. Keep `ENGINE_HELD_SEATS` confined to a separate worker
  engine configuration; never enable it as the human BYOC fallback.
- **P0.1a** remove the worker's hardcoded `glm-4.5` body-model and the
  lane-pin proof as rollout assumptions. Consume the separate `.prefer`
  lane's changes and receipt; do not duplicate or alter its semantics in
  this rollout lane. Verify the resulting client/worker selects from
  the live authorized catalog; LiteLLM resolves the deployment and any
  model alias, balancing, or fallback. Buckle preserves that request and
  records the served result without maintaining a second model router.
- **P0.2** put APIM in front of the VMSS Buckle model API. APIM validates
  the Entra token, tenant, audience, and allowed user/group before
  forwarding the request. The validated user identity and original user
  token continue to Buckle; block direct access that bypasses APIM.
  Buckle maps the stable user for its own federation, context, and logs.
  First test whether this token can reach LiteLLM's native JWT user/team
  mapping in the deployed version and license. [LiteLLM documents JWT
  user/team mapping as Enterprise](https://docs.litellm.ai/docs/proxy/jwt_user_team_auth);
  the repo's `compose.real.yaml` uses v1.103.0,
  while the VMSS image must be inspected. If unavailable, specify and test
  a narrow Buckle-to-LiteLLM user binding, or mark those LiteLLM per-user
  controls unavailable in the pilot. Never silently map all developers
  to one engine user. Never trust a client-supplied identity header
  without the APIM boundary. This protects the **model wire**, not merely
  the GUI `/api` seam.
  A Bearer PAT and a LiteLLM JWT cannot occupy the same Authorization
  header; verify LiteLLM's actual per-user binding mechanism for this
  request shape rather than assuming JWT passthrough works.
- **P0.2a** carry two distinct credentials on Copilot calls: Entra
  user token for APIM and Buckle admission (and LiteLLM user mapping
  where supported) and that user's GitHub PAT for the Copilot upstream.
  Keep the PAT in user-side CLI/worker
  configuration; Buckle and LiteLLM relay it only for the request.
  Prove the current client and LiteLLM version can carry both without
  one overwriting the other. Human BYOC stores no shared PAT in VMSS env,
  engine config, image or database. The isolated engine-held worker pilot
  mounts its owner PAT only as an engine secret, never into Buckle or an
  image. Both worker modes act under the owner's identity.
  Support both `Authorization: Bearer <PAT>` and the existing
  `/w/<lane>/<PAT>/v1` path where a client requires it. On Bearer-PAT
  calls, carry the Entra token in a separate named header validated by
  APIM; APIM must remove caller-supplied identity assertions before
  stamping the verified identity for Buckle. Never interpret the PAT as
  an Entra token or let a path PAT take precedence over a different
  Bearer PAT silently. Test the actual client behavior for each carrier.
- **P0.2b** verify the BYOC catalog path: with the owner's PAT, the
  owner and pilot worker can fetch the live Copilot catalog; with no
  PAT, the cold Copilot catalog is honestly unavailable. The current
  `src/catalog/buckle.catalog.fetch.ts` implements the cold behavior.
  Test per-user authorization even if model rows are cached seat-wide.
  A second user's PAT must never be reused or exposed by catalog cache,
  logs, traces, error bodies, or the current `/w/<lane>/<token>` URL
  carrier. If the carrier cannot be made safe, change it before rollout.

  **STATUS 2026-11-17**: catalog cache isolation landed — BYOC rows
  cache under the PSEUDONYMOUS user id (never the credential; one
  user's rows never served to another — unit-proven with per-bearer
  stub seats), and a tokenless caller gets honest emptiness (the
  warm-under-someone's-PAT branch is gone). Classic providers keep
  the seat-wide cache. Docker azure spec already proves the tokenless
  404-with-contract-hint and two-dev/two-principal isolation through
  the engine leg. Remaining live axis (two REAL seats' entitlements
  differing) is owner-pilot observation, blocked on the Entra client
  ID with the rest of P0.2.

- **P0.2c** prove unmodified Claude Code can use Buckle as its gateway:
  put its gateway variables in the user's Claude settings JSON. For
  Bearer-PAT mode, `ANTHROPIC_BASE_URL` points at the APIM Buckle
  `/w/<lane>` root, `ANTHROPIC_AUTH_TOKEN` carries the personal PAT,
  and `ANTHROPIC_CUSTOM_HEADERS` carries the separate Entra token.
  For URL-PAT mode, the base URL ends in `/w/<lane>/<PAT>` and
  `ANTHROPIC_AUTH_TOKEN` carries the Entra token in the normal
  Authorization header. Both are client settings, never repo settings.
  Exercise `/v1/messages` with tools, SSE, and a full tool round trip;
  forward Anthropic version/beta headers and streamed events in order
  without buffering. Enable gateway model discovery and verify
  `/v1/models` contains only the authenticated user's entitled rows.
  For the owner pilot, explicit script rerun on Entra expiry is enough;
  test automatic refresh before broad adoption. If the starting model ID is absent,
  select an entitled discovered model in the client or configure a
  LiteLLM alias; do not pin the lane or hardcode a Buckle model row.
  A local Fleet harness/skill/MCP may later acquire and refresh Entra
  tokens and set CLI configuration. A static settings token expires;
  prove a renewal path before broad adoption (for example a tested
  credential helper for URL-PAT mode). The Azure wire contract must
  work without a custom Claude Code binary. [Claude Code's
  gateway configuration](https://code.claude.com/docs/en/llm-gateway-connect)
  documents these variables. LiteLLM owns the Anthropic Messages to
  provider/model translation, including GLM and other model families;
  Buckle preserves that engine capability through federation and context
  injection. The live CLI test verifies our deployed chain, credentials,
  tools, and streaming. Anthropic's vendor support policy is not an
  architecture gate for this rollout.
  RECEIPT (2026-11-17, azure VMSS, buckle 0fa5f67): unmodified Claude
  Code 2.1.312 round-tripped the live chain — claude CLI → buckle
  `:4111/w/b3-gpt-consult/<PAT>` → engine byoc pass-through → MS
  Copilot seat (`claude-sonnet-5.5`); `-p 'Reply with exactly: wire
ok'` → exit 0, output `wire ok`. Curl leg: `/v1/messages` with tools
  - stream → 200 SSE with a streamed `tool_use` block (forced
    `tool_choice` is rejected by the seat itself — not a wire defect).
    `/v1/models` returns the entitled seat catalog. Live lessons: (1) a
    lane's pinned model overrides the request body model — pin a
    messages-capable model (a Responses-only pin such as `gpt-6.1-terra`
    yields Copilot's `no model endpoints available given user
constraints` on `/v1/messages`); (2) headless CLI runs need a fresh
    `CLAUDE_CONFIG_DIR` with `{"hasCompletedOnboarding":true}` — the
    default config dir's keychain/OAuth touch hangs a no-TTY `-p` run
    before any HTTP. The Entra/`ANTHROPIC_CUSTOM_HEADERS` leg rides the
    APIM front door (P0.2, client ID still awaited).
- **P0.2d pilot shortcut (owner approved)** use a small standalone
  Node/Bun script under `test/manual/entra-login/` while the final auth
  tooling is decided. **STATUS: package written (`@fleet/buckle-entra-login`
  0.1.0, 8 unit tests green, own tsconfig/deps, excluded from the root
  project; live owner pilot pending the Entra client ID).** Usage:
  `bun test/manual/entra-login/src/entra-login.main.ts <config.json> [claude
args…]` — config is a 0600 machine file shaped like the committed
  `entra-login.example.json` (placeholders only); the PAT lives in its own
  0600 file. Give it a registered public-client app ID, tenant,
  API scope, gateway URL and a local PAT file path through runtime config.
  Use MSAL's browser authorization-code flow to obtain an API access
  token after tenant-required MFA; do not use a Graph token or ID token.
  Write a private temporary Claude settings file, preflight APIM, then
  launch the CLI. Support the URL-PAT and Bearer-PAT configurations above.
  On expiry, exit clearly and rerun the script; automatic renewal, a
  permanent token cache, skill/MCP packaging and a new client repository
  are not pilot prerequisites. Keep its dependencies in its own package;
  no Buckle runtime dependency or production auth subsystem is added.
  The script does not replace APIM validation or the per-request identity
  contract. Record the live owner pilot separately from org readiness.
- **ORG.1 (deferred; not a P0 exit requirement)** ship the permanent
  login/bootstrap command before general org access. The temporary script
  is sufficient for the owner pilot and extraction. The command checks the Entra token cache silently,
  opens the system browser for interactive sign-in when required, and
  offers device code as a fallback. It requests the APIM API audience,
  stores the token in an OS-protected user cache, and preflights a safe
  authenticated Buckle catalog request before launching Claude Code.
  On APIM 401 during use, reacquire once and recheck access;
  never ask an LLM to repair login. A 403 or valid-token group denial
  remains an access error; do not loop through browser sign-in. In
  URL-PAT mode, test Claude Code's
  `apiKeyHelper` as the renewable Entra credential (it emits the token
  only and sends it in both Authorization and `x-api-key`; Buckle must
  ignore that `x-api-key` as a Copilot PAT). In Bearer-PAT mode, prove a
  separate dynamic Entra-header injector or require an explicit session
  restart; a static JSON header is not a renewal strategy. Use a small
  local CLI first; a skill or MCP can call it later. [MSAL cache and
  interactive guidance](https://learn.microsoft.com/en-us/entra/msal/msal-acquire-cache-tokens)
  and [Claude Code's credential helper](https://code.claude.com/docs/en/llm-gateway-connect)
  are the implementation references.
- **P0.3** run the current Pi Durable worker under the owner's verified
  identity in the declared BYOC or isolated engine-held mode. Keep a
  separate Fleet run ID; neither mode is a separate Copilot seat or
  independent worker identity. Provision admission credentials through
  the operator bootstrap; do not build a Buckle credential broker.
  From the live catalog choose an available model, prove direct LiteLLM
  chat and Buckle chat/stream with the actual served model, then run the
  full repoagent cycle on issue #6 if still suitable (real diff, PR,
  branch preview). Restart mid-cycle and record recovery and failures.

**Owner-pilot exit (unblocks P1)**: APIM validates the owner and passes
the verified identity and original Entra token to Buckle. Native LiteLLM user mapping is proven
where available; otherwise record the pilot limitation and block broad
multi-user rollout until per-user binding is tested. Both URL-PAT and
Bearer-PAT paths preserve the same user attribution;
the human client's owner-provided PAT reaches Copilot through Buckle and
LiteLLM without a server-held shared PAT on the human route. The worker
cycle uses the separately recorded auth mode. Catalog, chat, stream, context injection,
usage attribution, and denial without a valid user/PAT are observed live.
Test missing, expired and invalid Entra tokens; missing and invalid
BYOC PATs; conflicting URL and Bearer PATs; and refusal to use the
owner-worker engine credential on a failed human request. Redact URL
credentials from APIM, Buckle,
LiteLLM, reverse-proxy, and trace records.
Cold-start login must open the browser before any model call. The owner
pilot may recover an expired token by rerunning the temporary script;
automatic renewal is an org-readiness gate. A denied principal receives
a clear error without a sign-in loop.
The worker cycle produces a real PR and resumes the same submission after
restart. Record commands, source SHA, image digests, VMSS instance,
selected and served model, declared auth mode, result links and timestamps.
Relevant Docker Desktop tests pass on the same source. Synthetic two-user
credential-isolation tests are required; two live developer accounts and
the permanent login tooling are not prerequisites for the owner pilot.

**Org-readiness exit (before broad access; does not block P1/P2)**:
complete ORG.1 and prove two real Entra users with their own PATs have
isolated catalogs, policy context, logs and usage through APIM and the
selected LiteLLM user binding. Test cross-user/spoofed identity, revocation
and token renewal. Record known pilot gaps until those tests pass.

**Checkpoint**: this exact system is what fleet-worker extracts.

## P1 — fleet-worker repo (extraction; product = code + images + e2e)

- **P1.1** skeleton mirroring fleet-buckle's laws (AGENTS.md adapted:
  TYPE LAW, NO-TRY-CATCH, 400-line/60-fn/25-stmt, qlty blocking, knip,
  no-slop tests, edit law, exactOptionalPropertyTypes, TS4111; package
  scripts; tsconfig.base; .githooks/pre-commit; dotfiles; knip.jsonc).
- **P1.2** move: `deploy/worker/worker.*.ts` (11 files, 866 lines) →
  `src/` (names preserved, minimal churn); the 38 pi-durable `examples/`
  → `examples/` (durable-API reference, ships with the product);
  `deploy/worker/Dockerfile` → root `Dockerfile`; `test/kit/stub` →
  `test/kit/stub`; `test/e2e/buckle.e2e.agent.spec.ts` →
  `test/e2e/worker.cycle.spec.ts` composing the PUBLISHED fleet-buckle
  image (registry-pin env, version matrix).
- **P1.3** pin the Pi Durable runtime to the exact version currently
  used by the worker (`1.5.0`) and carry its copied examples as a
  versioned reference. Prove the image build works under the intended
  offline-LAN dependency policy; document the pin in AGENTS.md.
- **P1.3a** inventory the complete extraction closure, including
  `src/agents/`, any seed build, supervisor docs, root runtime dependencies
  and exports. Give each file one home: move worker responsibilities to
  fleet-worker, keep only gateway contracts in Buckle, or remove proven
  unused code in a separate bounded cleanup. The historical lift table
  does not authorize copying more monorepo code. Confirm inventory and
  actual installed versions; file counts in this roadmap are not proof.
- **P1.4** gates port: tools/src/{check-laws,laws.scan,laws.shapes},
  playwright config, unit tests, CI = tsc + unit + e2e + qlty + knip.
- **P1.5** publish/pin the immutable Buckle image needed by the new
  standalone worker e2e before cutting the test over. Replace the VMSS
  worker with a pinned `fleet-worker` image, prove journal compatibility
  and the real cycle, and retain a rollback image. Only then remove
  `deploy/worker/` and its tsc target from Buckle; keep a pointer doc
  and cross-repo version matrix. Both repos' gates must remain green.

**AC**: fleet-worker standalone green (tsc, unit, e2e cycle vs published
buckle image, laws, knip); fleet-buckle green without worker code; both
landing commits cross-reference shas; image builds:
`docker build -t ghcr.io/klh/fleet-worker:<sha> .`

**Checkpoint**: `fleet-worker` builds an image that passes its own e2e.

### Eight-worker recovery procedure

The launcher and this procedure belong to fleet-worker's deployment
tooling; Suspenders supplies admission/recovery integration as it lands.
Buckle has no worker-spawn API or deployment supervisor for this demo.

1. Start eight scoped workers on the pinned current image. Record each
   run ID, assigned work, worktree, journal/checkpoint and writer epoch.
   Place each journal on an explicitly identified persistent volume,
   outside its replaceable container; verify it is remounted on restart.
2. Publish the replacement image to ACR and record its digest. Publishing
   alone is not the crash. While work is active, explicitly stop/kill all
   eight worker containers using the deployment tool. Record that exact
   command, the affected VMSS instance and the interruption timestamps.
   Buckle/LiteLLM may stay running; record separately if they also restart.
3. Deploy the new digest and start the workers against their original
   journals and run IDs. Acquire new writer epochs and refuse old writers.
   Reconcile GitHub effects before retrying so comments, PRs and commits
   are not duplicated. Resume the same work rather than create new jobs.
4. Prove all eight resume from recorded checkpoints and produce reviewed
   outcomes. Record old/new image digests, recovery times, reconciliation
   evidence and rollback. A volume surviving container replacement is
   not proof of VMSS reimage/host-loss recovery; test those separately
   with storage that survives that failure before claiming host recovery.

**RECEIPT — live on the Azure VMSS, 2026-11-17 (fleet-worker
`2697dd5`, buckle `b5d5726`)**. Rig repo `klh/fleet-recovery-rig`, 16
GitHub-issue tasks, supervisor container with N clone lanes (not eight
separate containers; a documented deviation — one supervisor owns the
lane lifecycle, each clone is its own process/journal). Wave 1: 8
issues → 8 clones → 8/8 tasks done first-attempt (~30s/task), 8 PRs
merged. Wave 2: 8 more issues; at 01:25:07Z, mid-work,
`sudo docker compose stop supervisor` (buckle/engine/gui/health stayed
up); clones died with PID 1; tasks 9-15 settled in the final seconds
(PR #31 closed the last one), task 16 stranded on dead clone-8. The
claim lease (`LEASE_MS` = 15 min, hardcoded) expired at 01:39:47Z;
the boot sweep flipped task 16 to requeued, the spawner respawned a
fresh clone, which reclaimed it at `attempts: 2` (~01:40:25Z) and
settled it ~90s later as PR #32 — merged. No writer epochs exist;
recovery is task-level at-least-once: per-lane journals
(`/state/<lane>.sqlite`) and workspaces (`/workspace/<lane>`) ride
persistent volumes. PR-match reconciliation scanned open PRs for
"Closes #N" and avoided a duplicate PR in this run; it does not cover
closed/merged PRs or prove idempotency of other GitHub effects.
All 17 PRs merged, branches deleted, 16/16 tasks done. Old/new image
digests were identical (`2697dd5`) — the kill leg proves lease/requeue
redelivery, not cross-image journal compatibility; that stays
untested until the next worker image rotation replays this procedure.
Host-loss reimage recovery remains untested (single VM).

## P2 — real microVM tool execution on the existing VMSS

- **P2.1** pin Gondolin and its selected backend. Verify usable KVM on
  the VMSS rather than assuming `/dev/kvm` alone proves it. If that
  backend cannot boot there, record the result and select a supported
  QEMU/libkrun mode explicitly. Firecracker is a later Linux/KVM option.

  **RECEIPT — live on the Azure VMSS, 2026-11-17**. Pinned
  `@earendil-works/gondolin@0.14.0`, backend `--vmm qemu` (krun aborts
  on x86_64 in 0.14.0 — known issue, fix unreleased). Disposable
  container `oven/bun:1-slim` + `qemu-system-x86 qemu-utils` on the
  VMSS, guest `alpine-base:0.5.0` (builtin content-addressed
  registry): `gondolin exec -- uname -a` → `Linux (none) 6.18.63-0-virt
… x86_64`. KVM proven by A/B, not assumed: WITH `--device /dev/kvm`
  cold 6.7s / warm 2.9s; WITHOUT (TCG) cold 11.3s / warm 7.0s. KVM
  access works from a plain container as root with `--device /dev/kvm`
  (buckleadmin itself lacks the kvm group; the device mapping
  suffices). First slice of P2.2 proven; the executor seam is next.

- **P2.2** keep the Pi Durable parent and journal in the OCI worker on
  the host. Add a Gondolin executor for bounded tool guests, with
  workspace leases, resource limits, default-denied network, and scoped
  credentials. A tool-guest proof is not whole-worker microVM packaging.

  **RECEIPT — axis landed live, 2026-11-17 (fleet-worker `f4b4622`,
  deployed to the VMSS as `worker:f4b4622`, all lanes green)**. The
  executor seam (`src/worker.exec.ts`) now has two backs behind one
  knob: `gondolinRun()` boots a pinned qemu VM (`alpine-base:0.5.0`,
  `createHttpHooks({allowedHosts: []})` = default-deny network,
  `vm.exec` argv form, `vm.close()` in finally = the workspace lease),
  and `checkFile` routes by `env.executor` (`WORKER_EXECUTOR`). The
  gondolin leg fails LOUD on code files — the pinned guest carries no
  python/node toolchain (P2.3 continuation: toolchain guest image) —
  rather than silently skipping the check or silently falling back to
  docker; either would undo the isolation the knob promises. Docker
  remains the default and the rollback. Six mock-module unit tests
  cover boot pinning, nonzero-exit throw with close still called,
  close-exactly-once, the loud refusal, and md no-ops on both backs;
  `tools/src/worker.smoke-gondolin.ts` is the live host proof entry.
  Same landing cleared the env-boundary law debt (sanctioned second
  loader `src/supervisor.env.ts`; lane spawns never spread
  `...process.env`; zod parses replace hand casts on sqlite/GitHub
  wire rows). Remaining to AC: a toolchain-bearing guest image so a
  real tool step executes inside the VM during the full cycle, the
  kill-the-guest fence/replace proof, and scoped-credential injection
  (secrets API is wired but unused by syntax-only checks).

- **P2.3** add a `WORKER_EXECUTOR=docker|gondolin` axis to the same
  whole-cycle test. The Gondolin adapter uses `VM.exec` and HTTP hooks;
  allow only the operation's named external/internal hosts and inject
  each credential for its matching host. The current `checkFile` seam
  runs syntax checks only; passing it does not prove GitHub/model calls
  execute inside the VM. Retain Docker as baseline and rollback.
  **STATUS 2026-11-17**: the axis knob and adapter exist (see P2.2
  whole-cycle gondolin test is PROVEN (receipt below); per-operation
  allowlists remain open.

  **P2.3 whole-cycle receipt (2026-11-17, fleet-worker 8bfcb3d):** the
  toolchain guest landed. worker-check:0.1.0 (gondolin buildId
  e2383717, x86_64, rootfsPackages python3+nodejs+uv+bash+curl) built
  from the default gondolin config; checkFile's gondolin branch now
  writes the file into the VM (vm.fs.writeFile) and runs python3 -m
  py_compile / node JSON.parse / node new Function INSIDE the guest
  (string-form exec — sh -lc resolves $PATH; argv form does no PATH
  lookup). Default-deny egress unchanged; VM closed on both paths.
  LIVE on the VMSS: in-container adapter proof (ALL-CHECKS-IN-VM-OK:
  .py + .json + .js under --device /dev/kvm), 15.6s cold / 15.2s per
  fresh-VM check (isolation price vs docker ~385ms — VM-per-task lease
  is the optimization), and a full QUEUE-PATH cycle green under the
  gondolin env (supervisor image worker-gondolin:8bfcb3d +
  WORKER_EXECUTOR=gondolin: recovery-rig issue #33 → task 17 →
  clone-1 session → PR #34, converter.py) — with the CORRECTION that
  this cycle did NOT exercise checkFile: the queue path runs agent
  sessions whose gate runs the repo test command (kind "none" on the
  test-less rig); checkFile (worker.flow.ts:219) is the SWEEP path's
  pre-PR fence only. Closing that gap is the next leg: the queue path
  needs a post-session changed-files check through the same
  checkFile seam (in-VM syntax fence on every PR the lanes raise).

  **Queue-path fence receipt (2026-11-17, fleet-worker 298d2aa):** the
  post-session fence is LIVE and PROVEN. worker.lane.ts now fences every
  changed file after the session settles and before the report: default
  branch via gh, `git diff --name-only origin/<default>...HEAD`, per-file
  checkFile (cap 25 files / 256KiB; missing/oversized → named `:skipped`,
  never silent), and the report note banks the evidence. First live fire
  (recovery-rig issue #35 → task 18 → lane-1, worker-gondolin:298d2aa):
  report #24 `settled=done pr=37 turns=14 note="session:settled;
fence:1[roman.py:py_compile]"` — the agent's roman.py was compiled by
  python3 inside the qemu toolchain guest BEFORE the PR banked green, PR
  #37 merged clean (+58/-0 single file). The fence also caught two real
  deployment gaps on the way (clones lacked XDG_CACHE_HOME → EACCES
  /tmp/.cache/gondolin; static lane services lacked the gondolin env and
  died on a socketless docker call — Bun fetch TypeError "typo in the
  url or port") — loud failures, requeue, fix, green: the design working
  as intended. Compose now carries WORKER_EXECUTOR+XDG_CACHE_HOME+/gcache
  on supervisor AND lane-1/lane-2 (uniform topology; lanes never touch
  the host docker socket). Remaining P2.3 legs: journal outcomes (the
  gate journal records only the repo test command — kind "none"
  pass-through on the test-less rig), VM-per-task lease (15s/check
  cold-boot price), scoped-credential injection via createHttpHooks
  secrets.

  **Kill-the-guest receipt (2026-11-17, fleet-worker 298d2aa):**
  guest death, loud failure, requeue and fresh-guest fence are proven
  live; same-conversation resume is not. Rig issue #44 (b64.py) → task 22
  → clone-5, with a host-side sniper loop (`pkill -f
"[q]emu-system-x86_64"` every 1.5s — the bracket class dodges the
  pkill self-match trap) killing the toolchain guest mid-fence.
  Reports #28/#29: `settled=error pr=null turns=0 note="Error: error
protocol_error: virtio bridge error: read ECONNRESET (qemu:
qemu-system-x86_64: terminating on signal 15)"` — the guest death is
  loud, names SIGTERM, banks no PR, and requeues. Attempt 1 had
  already raised PR #45. `turns=0` in the error reports is the lane's
  error-report default, not evidence of journal replay. Sniper stopped →
  attempt 3: report #30 `settled=done pr=45 turns=14 note=…fence:1
[b64.py:py_compile]` — fresh VM fenced the same diff green, PR #45
  merged. Two sniper bugs were caught by the rig itself on the way:
  racing the lane log misses a warm ~3s fence window, and a naive
  `pkill -f qemu…` loop kills its own shell on iteration 1. Also
  observed: fences currently run TCG (`-accel tcg` in the host ps
  catch, pid-level evidence) because worker-gondolin does not map
  /dev/kvm — ~15s/check vs ~3s with KVM (perf leg, not correctness).

  **KVM receipt (2026-11-17):** compose now maps `/dev/kvm` into
  supervisor + lane-1 + lane-2 with `group_add: ["993"]` (the host
  kvm gid; /dev/kvm is root:kvm 0660 and the containers run as uid
  1000 — numeric supplemental group, no image change). Post-recreate
  in-container probe: `VM.create` + `exec echo` in **3.0s** (boot+exec)
  vs ~15s under TCG, and the host ps catch shows `-accel kvm` ×14.
  Stack healthy after recreate; supervisor listening. /dev/kvm gid on
  this VMSS is 993 — bake it as a compose variable if the fleet grows
  beyond this box.

  **Fence VM-per-task lease receipt (2026-11-17, fleet-worker
  a4f6700):** `checkFiles(files)` boots ONE toolchain guest for the
  whole diff (lazily — an all-docs batch never boots) and keeps diff
  order; `checkFile` is single-file sugar over it. Live fire: rig
  issue #46 (JS port + node test suite) → task 23 → clone-1 →
  report #31 `settled=done pr=47 turns=9 note="session:settled;
fence:4[docs/TEST-SWEEP.md:unchecked;lib/b64.js:node-syntax;
package.json:node-parse;test/b64.test.js:node-syntax]"` — four
  files, three code checks, ONE boot under KVM (~3s, not 3×15s).
  PR #47 merged; the suite itself is 9 vector classes ×
  {encode,decode,round-trip} + a statelessness test — genuine tests,
  not presence stubs.

  **Gate-journal receipt (2026-11-17, same cycle):** the session gate
  leg is now proven on a test-carrying repo. The task-23 conversation
  journal (clone-1.sqlite, durable entries) banks
  `{"kind":"app.tests","cmd":"npm test","kind":"npm","passed":true,
"output":"> test\n> node --test\n\n✔ encodeB64: empty string …"}`
  — detect (package.json scripts.test) → in-container run (tool-seed
  carries node 26) → journaled GateOutcome, while earlier test-less
  sessions bank `kind:"none" … no tests detected — gate pass-through`
  rows in the same table: the contrast proves the detection, not a
  hardwired pass. This receipt tests only a passing suite. A failed
  gate is noted by harvest, but the current lane can still report
  `done` when a PR exists; P6 Step 4 closes that settlement gap.
  Scoped-credential injection via createHttpHooks secrets is
  DISPOSITIONED DEFERRED: fence guests are default-deny with no
  network need, and the plaintext childEnv() seam's consumer (guest
  egress) does not exist yet — revisit when a task legitimately needs
  guest network.

  P2.3 legs status: queue-path fence ✓, kill/requeue/replace ✓, KVM ✓,
  VM-per-task lease ✓, gate journal ✓, scoped credentials → deferred.
  **P2.3 executor axis closed.** Same-conversation recovery is P6.

- **P2.4** package the runner so Docker Desktop can exercise it locally,
  but require a separate live VMSS boot, tool, loss, and cleanup receipt.

  Local receipts (2026-11-17, Docker Desktop, fleet-worker 7016770,
  supervisor-compose.local.yaml + real overlay):
  - **BOOT**: hermetic world (zai-stub + gh-stub + buckle3 + supervisor)
    up clean; supervisor listening :7780.
  - **TOOL (real leg)**: issue #91 on icomdev/Vanilla-JavaScript-Calculator
    → imported → clone lane → session via the Azure seat (claude-sonnet-5.5
    BYOC lane) → branch agent/91 → **PR #92 merged-ready, 307 node --test
    pass**, docker fence `fence:4[README.md:unchecked;docs/KEYBOARD.md:
unchecked;script.js:node-syntax;test/keyboard.test.js:node-syntax]`,
    task settled=done (turns=9, 964 out-tok, 45.6 s).
  - **LOSS (banked 2026-11-17 06:12)**: `docker compose kill supervisor`
    mid-task (issue #93, branch agent/93 cut, session mid-flight) →
    lane processes died with the container; restart booted clean and the
    task rode the 15-min lease (supervisor.store.ts frees `assigned`
    tasks only at lease expiry). At expiry the sweep requeued it
    (attempts 1→2), a fresh clone claimed it, integrated the orphaned
    remote agent/93 branch without force-push, and settled **done**:
    **PR #94**, 359 node --test pass. Lane-loss with the supervisor
    ALIVE is the loud immediate requeue (ECONNRESET, proven on VMSS);
    supervisor-loss is lease-clock recovery — both receipted.
  - **CLEANUP**: `down -v` removes the world + volumes (receipt below).

  Root causes found on the local leg (all fixed in fleet-worker 7016770):
  Docker Desktop's socket is root:root 0660 (VMSS is root:docker 993) —
  `group_add: ["0"]` or the fence's unix-socket fetch dies as
  FailedToOpenSocket; the lane's gh CLI legs hardcoded real github (now
  REST via env.ghUrl + WORKER_GIT_URL); importOne's dupe guard ignored
  failed tasks (poison re-mint); handleReport double-read the body
  ("Body is disturbed or locked").

**AC (executor portion met):** a real VMSS microVM executes a tool step
during the full worker cycle. Guest kill reports failure, requeues, and
fences the diff in a replacement guest. Same Pi conversation resume is
still open under P6. Docker Desktop passes the executor contract where
supported; label its backend separately.

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
  autonomous job, and model usage distinctly; no raw personal seat
  token belongs in a tool guest.
- **P3.5** maintain a compatibility matrix for the deployed LiteLLM
  version: chat, streaming, tools, responses and other endpoint families
  actually offered by each model engine. Buckle forwards supported
  calls and policy-bearing context without narrowing LiteLLM's feature
  surface; unsupported provider features fail honestly at the engine.

**AC**: a developer reaches an H100-served model through Azure Buckle;
a Pi job reaches its entitled route; both expose actual model/host usage.
Denied access and a lost peer fail visibly. Docker federation tests remain
green, but the on premises route must have its own live receipt.

## P4 — Fleet-controlled jobs and measured splitting

Fleet Suspenders admits jobs, applies capacity and fencing, launches a
versioned Pi Durable parent, and reports its journal, tool guests, model
usage, patches, reviews, and recovery. The parent chooses solo work or
children. Children receive separate Fleet run identities, budgets,
worktrees, and nonoverlapping write scopes; the parent integrates and
checks their patches. In the pilot, their Copilot requests still ride
the owner's identity, with PAT custody determined by the recorded BYOC
or isolated worker-engine mode. Dedicated worker identities and
Copilot entitlements require a later explicit migration and access test.
A no-split choice is a valid recorded outcome.

**Receipts**:

- **2026-11-17 (parent/children split, live)** — worktree-per-child
  landed (fleet-worker `570a1f0`: `worker.session.scopes.ts` registry,
  `sessionTaskHost.spawn` cuts `git worktree add -b <parent>-cN
.children/<branch>`, depth cap 1, bash/gh/gate resolve cwd per
  caller) and PROVED live on the VMSS rig: issue #51
  (`klh/fleet-recovery-rig`, "two INDEPENDENT additions") was claimed
  by the parent session, which did reverse.py solo, spawned a child
  (worktree branch `agent/51-c1`, commit `62798f2` "Add Unicode case
  helpers and table-driven CLI coverage for #51" authored in the
  child), MERGED the child's commit into mainline `agent/51`
  (`61863d8`), finished the docs itself, and settled done — PR #52,
  fence:6, 130 python tests passing, 21 turns, 202s. The child's
  branch, worktree dir (`.children/agent/51-c1`), and merged commit
  were all observed on disk post-run.

- **2026-11-17 (stale-lease refusal, d3584bd)** — `bankReport` used to
  settle any report unconditionally: a zombie lane whose lease had
  lapsed (task requeued and reclaimed) could still flip the task to
  done with its PR — stealing the settle from the live claimant.
  Guard added (report from a lane ≠ task owner is banked for the
  record, state untouched) + two units (zombie refusal; cancelled
  task refuses a late PR). Deployed to the VMSS supervisor. The
  revocation run already exercised the precondition live (clone-4's
  ghost claim was lease-swept and requeued); with the guard, its
  late report would have been refused instead of banking a second
  settle.

- **2026-11-17 (simultaneous jobs, 8-way)** — supervisor on the Azure
  VMSS (worker-gondolin:4858518, MAX_LANES=8, executor=gondolin,
  /dev/kvm) imported 8 freshly minted issues
  (#95–#102) from `icomdev/Vanilla-JavaScript-Calculator`, ramped one
  clone per 15s spawn tick to **7 simultaneous working lanes**, and
  settled **8/8 tasks done with zero failures and zero retries** in
  ~4 minutes of wall time (sessions 99–167s, 14–23 turns,
  2.7K–8.9K out-tokens each): PRs #103–#110. Fences ran on every
  settle (up to fence:9 on #110 incl. `tests/backspace.test.js:
node-syntax`); one transient `remote rejected … commit_refs_rules`
  push was retried and landed by the lane itself (#106). Sessions ride
  the Copilot seat lane via the principal-Bearer shape (WORKER_BYOC=
  false). Evidence: supervisor board (tasks 24–31 done),
  `[lane clone-N] task N: settled=done pr=…` log lines, PRs on the
  fork. The rig-era 8-worker recovery (23 tasks on
  klh/fleet-recovery-rig) predates this on the same plane.

- **2026-11-17 (run-key revocation + recovery, live)** — with the
  worker principal key pulled on the Azure buckle
  (`mv /state/keys/principal.worker@azure.key …key.revoked` — the
  registry reads key files per request, so the rename bites on the
  next ask), a claiming lane died loudly at its prefer probe
  (`no model passed the probe`, exit 1) and the task requeued. The
  owner PAT was proven untouched (GitHub API 200 with the PAT — it
  never rides buckle). Recovery: `POST /admin/keys {"principal":
"worker@azure"}` minted a NEW key (old value dead), written to
  /opt/buckle/secrets/buckle_key (0600), supervisor recreated. A
  ghost claim from the crash-loop window waited out the 15-min
  lease clock (sweepExpired requeue — supervisor-loss semantics),
  then a fresh clone ran a real session through the seat and settled
  **PR #50 on klh/fleet-recovery-rig** (task 34, issue #49,
  caesar.py + pytest, turns=17, fence:4). Bonus evidence: a
  mismatched issue body (calculator files named onto the python
  rig) was REFUSED twice by the seat — no fabricated work
  ("Blocked: … no calculator files … no existing MS/MR/MC
  implementation") — before the corrected issue went green in one
  attempt.

**AC**: run two simultaneous jobs and one parent/children job on the real
hosts. Independently kill a guest and a parent; prove journal resume,
stale-lease refusal, no duplicate unsafe GitHub effects, Fleet run-key
revocation (without revoking the owner's PAT),
and an operator recovery path. Normal developer chats remain separate
from autonomous Fleet claims despite sharing Buckle transport.

**PILOT CLOSED 2026-11-17** — simultaneous (8-way) and parent/children
(PR #52) receipts above; guest kill and supervisor-loss lease requeue
recovered at the task level. The receipts do not prove the same Pi
conversation resumed or that every unsafe GitHub effect is idempotent.
Stale-lease refusal was unit-proven and deployed; PR duplicate scan and
ownership guard are pilot defenses, not exactly-once proof. Run-key
revocation was live; operator
recipes written down in fleet-worker `docs/RECOVERY.md`. Developer
chats stay separate: autonomous claims only ever touched
`klh/fleet-recovery-rig` + the calculator fork, never an interactive
developer repo, while interactive sessions rode the same buckle front
on their own principals — zero cross-contamination events in every
receipt above.

## P5 — BLAM optimization; Decant and Fleet knowledge later

BLAM runs isolated matched trials during spare capacity. Hold task,
revision, model entitlement, aggregate budget, private judge, and merge
gate fixed while comparing solo work, concurrent tools, and parent/child
shapes. Measure accepted patches, wall time, tokens, contention,
recovery, and duplicate effects. Promote a versioned seed only with a
reproducible receipt and rollback digest. Benchmark runs must not write
to production developer repos.

**FIRST SLICE RECEIVED 2026-11-17** (fleet-worker `docs/TRIALS.md`):
three-arm matched trial on the real VMSS plane — seed `9011741` cloned
into three private trial repos, task set T1–T4 (two file pairs each)
minted identically per arm; solo (1 lane) vs concurrent (4 lanes) vs
split (1 lane + workers_task hint). All 12/12 settled done att=1,
fence:6, exactly one PR per task, zero duplicate effects. Concurrent
arm: 2.2× wall-clock (11.2 → 5 min), no per-session slowdown at 4
simultaneous seat sessions. Split arm: +27 % session wall, −18 %
mainline out-tokens. Trial repos are disposable (never production dev
repos). BLAM-as-a-package is deliberately NOT ported (owner directive:
the supervisor plane IS the trial harness); Decant/Fleet-knowledge
stages remain future work.

Once job identity, provenance, and access boundaries are stable, add
Decant/Fleet knowledge as scoped context. Record the knowledge version
used by each run. Absurd may then be compared as a Postgres-backed
cross-host delivery queue, but it must replace a named delivery duty
rather than create a second unreconciled Fleet work ledger.

---

Original rollout dependency order: **P0 owner-pilot exit → P1 → P2 → P3 → P4 → P5**.
The separate org-readiness exit gates broad access, not extraction or
the owner-worker demo. Inventory and
federation preparation may run alongside extraction, but every Azure or
on premises claim needs its own live exit receipt. P0's Entra/APIM pilot
remains open; P6's worker reliability work can proceed against the
existing pilot without treating that open identity gate as passed.

Every receipt pins source commit, Buckle/worker/engine image digests,
seed digest, model route, runner backend, host, and timestamp. Keep the
last known-good deployment for rollback. Use the existing Fleet work
graph and live coordination to assign implementation ownership; a DONE
item or this plan alone does not prove a service is deployed.

## P6 — one durable job lifecycle and an operator UI (planned 2026-11-17)

P1–P5 record real pilot receipts. They do **not** prove that a retried
supervisor assignment resumes the same Pi Durable conversation, that an
unsafe external effect is reconciled exactly once, or that the current
"background" child survives its parent's tool call and process death.
P6 closes those gaps before treating the pilot as a reliable autonomous
worker service. Design references are the installed
`@earendil-works/pi-durable@1.5.0` API, upstream examples
[`22-subagent-background`](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/22-subagent-background.ts),
[`32-tests-after-edits`](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/32-tests-after-edits.ts),
[`34-submit-in-commit`](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/34-submit-in-commit.ts),
[`40-tool-waits-for-webhook`](https://github.com/earendil-works/pi/blob/main/packages/durable/test/examples/40-tool-waits-for-webhook.ts),
and the [Cloudflare wake/activity example](https://github.com/earendil-works/pi-durable-cloudflare).
Verify APIs against the pinned package before adopting a newer upstream
example; copying the example's React or Cloudflare host is not planned.

### Separation of concerns and authoritative state

| Owner                             | Authority and output                                                                                                                                                                                                 | Boundary                                                                                                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fleet Suspenders                  | Global job admission, capacity, placement, writer epoch, operator cancel intent and audit.                                                                                                                           | The current `fleet-worker` supervisor is a pilot adapter. Migrate it deliberately; never run two independent authoritative schedulers for the same jobs.                                    |
| `fleet-worker` Pi host            | One process owns each journal. The durable job document and task graph own conversation/submission identity, local phase, child ownership, gate outcome and effect receipts. Expose versioned read and command APIs. | Do not mint global Fleet work or open one journal in two processes. An external control DB and a Pi journal cannot share a transaction; reconcile with stable keys and idempotent commands. |
| `fleet-worker` execution adapters | Assignment-scoped workspace, GitHub effects, Gondolin/Docker tool guests. Model connection and journal stay outside the guest.                                                                                       | A guest neither decides job state nor owns the sole journal. Never clean a workspace still used by a live conversation.                                                                     |
| `fleet-buckle` and LiteLLM        | Buckle owns identity, context, traffic and usage observation; LiteLLM owns model routing.                                                                                                                            | Neither schedules workers or owns Pi task state.                                                                                                                                            |
| `fleet-health`                    | Outside-process service and host health verdicts.                                                                                                                                                                    | A responsive service or heartbeat does not certify productive Pi work.                                                                                                                      |
| Operator GUI                      | Separate thin client over authenticated, versioned HTTP snapshot/stream/command APIs.                                                                                                                                | No SQLite, Docker, journal or orchestration imports; no second mutable job ledger.                                                                                                          |

The admission owner mints one **global job ID**. Each placement has a
monotonically increasing **writer epoch**. The Pi journal stores that ID
and epoch with the conversation, submission request ID, workspace and
phase; the control plane stores the journal locator and last accepted
receipt. Old-epoch reports and commands cannot change current state.
The Pi task graph is live execution truth, the control assignment is
placement truth, and a terminal receipt is historical outcome.
Disagreement is an explicit `reconciling` state, never a guessed `done`.

### Ordered implementation slices

Each numbered step is a dependency boundary. Dispatch it as bounded,
one-repository, one-behavior work items with file allowlists and tests
per `implementation-contract.md`; do not give one agent all of P6.

1. **[ ] Step 1 — remove competing paths and establish the layout**
   (`fleet-worker`; prerequisite for later steps). Inventory
   `worker.main.ts`'s `flow|durable`, the separately launched
   `worker.lane.ts`, and `supervisor.main.ts`. The canonical target is
   one per-assignment Pi `JobTask` using the existing session extension:
   the lane entry point becomes a thin admission/host adapter, while
   comment from pi: the inventory half is already in the lanes' queue — fleet-worker issue #1 mints exactly this map (docs/ownership-map.md, five files, target-module table, moves-with-risk list). Sequencing note: worker.durable-main.ts already trips the 400-line warn (402) — it is the first decomposition candidate the map should name; every moved file must stay law-clean (typecheck+test+check-laws) per move, thin compat entry points included.
   the `flow` sweep and forever GitHub-scanning durable mode are
   migration sources, not competing supervised runtimes. Inventory
   their behavior and tests before retiring either; no silent deletion
   or wholesale rewrite. Decompose the mixed files by responsibility
   into small `job/` (identity,
   durable task, receipts), `agent/` (harness, conversation, child,
   gate), `execution/` (workspace, GitHub effects, guest tools), and
   `adapters/supervisor/` (temporary pilot wire) modules. Keep thin
   compatibility entry points, `worker.env.ts` as the worker env
   boundary, and existing laws. Move no scheduler or Pi code into
   Buckle. **Exit:** one documented start path for supervised jobs,
   one ownership map, no duplicated scan/settle logic, unchanged pilot
   cycle against the existing image contract, and typecheck, unit,
   law and e2e gates green. Each physical move gets its own bounded
   file allowlist.
2. **[ ] Step 2 — make local recovery state safe** (`fleet-worker`;
   after 1). Quarantine the old durable-scanner mode until its
   `worker.durable-main.ts` error path cannot return `rows: {}` and
   overwrite `AgentDoc`; migrate committed rows without losing their
   conversation IDs. Close the committed-conversation/before-submit
   gap using one journal commit for the job record and initial
   comment from pi: same class, same step — the useTemplate leak (review #10) is module-global templateText in worker.model.ts surviving across tasks (null keeps the prior mission template; `if (!name) return` at worker.session.ts:360). Schema law cannot catch this: internal call, legal `string | null | undefined` signature, no wire boundary — P6 steps 2/5 kill the class by moving per-task state into journaled context; interim fix = null CLEARS templateText + a unit test proving task B's ask prompt does not contain task A's template. Same for the scopes Map (#7).
   submission, or a replayable `unsubmitted` phase that stores the
   original issue payload. Persist child/workspace scope instead of
   relying on `worker.session.scopes.ts`'s process-local map. Reopen
   after `harness.closed` reports failure; restore workspace, provider
   and child scopes before `resume()`. Do not `git clean` a workspace
   containing unfinished journal work. **Exit:** crash injection at
   each boundary resumes the same conversation and checkout; a GitHub
   or storage error cannot erase the issue index.
3. **[ ] Step 3 — bind placement to one Pi job** (`fleet-worker` wire
   first, then a separate Suspenders integration item; after 2).
   Define a versioned assign/snapshot/cancel/receipt contract with
   `jobId`, `epoch`, `journalId`, `conversationId`, `submissionId` and
   idempotency keys. Admit the first request once in that conversation;
   re-delivery finds its submission instead of making a fresh
   comment from pi: the d3584bd stale-lease guard (bankReport refuses non-owner lane) already blocks zombie settles at the store level — KEEP it until the epoch CAS lands (defense in depth), then retire it in the same commit that ships epochs, with the refusal unit test ported to the epoch form. Do not run naked even for a day.
   ownerless conversation. Persist assignment intent and Pi admission
   through a recoverable outbox/reconciliation step because the two
   stores cannot commit atomically. Compare-and-swap reports and
   cancellation by epoch. Cancel reaches Pi `abort()` and owned
   children and records whether cleanup completed. Migrate the pilot
   supervisor behind this contract, then switch placement authority
   to Suspenders without dual dispatch. **Exit:** lost claim response,
   expired lease, stale writer, repeated cancel and lost report yield
   one active conversation, one accepted terminal receipt and no
   zombie settle. The existing P4 lease receipt is baseline, not this
   proof.
4. **[ ] Step 4 — checkpoint the job and external effects**
   (`fleet-worker`; after 3). Define Pi task phases for workspace
   ready, admitted, working, validating, delivering and reporting.
   Pi commits own phase transitions; a fixed ten-minute stale mutex
   cannot steal an active scan. Give each GitHub branch, comment, push
   and PR action a stable job/effect key and an observed-before-retry
   comment from pi: the FAILED-GATE-SETTLES-DONE bug (review #4) already has its fix sites located — worker.session.gate.ts:89, worker.session.guards.ts:231, worker.lane.ts:279 (PR-existence check gates the settle). This step's phase model is the durable fix: make the gate outcome a PHASE INPUT to 'reporting', not a post-hoc check; journal app.tests result (kind:passed/failed/none — detection proven in the task-23 receipt) and refuse done-settle on failed. Land the small guard first (bounded, testable now), the phase model second.
   reconciliation query covering open, closed and merged PRs. Bank the
   remote result before advancing. `afterRun` remains the test hook;
   an `onYield` review task may hold the final answer until its verdict.
   A failed gate cannot report `done` merely because a PR exists.
   Paginate journal
   usage and gate reads beyond the current first 200 entries. **Exit:**
   kill after each remote effect but before its receipt; recovery
   neither duplicates nor loses it, and failed validation cannot make
   the job green.
5. **[ ] Step 5 — implement foreground and background children**
   (`fleet-worker`; after 2–4). A foreground child is owned by its
   replay-safe tool task: find an existing child by owner task before
   creation, use a stable request ID, wait for its outcome, and merge
   only reviewed commits. A genuinely deferred child uses a durable
   background anchor and reporter task, as in upstream example 22;
   messages and report-back have stable IDs. Persist child branch and
   worktree scope and restore it after restart. Honor `awaitResult`:
   return `completed` only after completion; otherwise return a durable
   handle with check/steer/cancel. **Exit:** crash during child creation,
   execution or report-back produces one child, correct scope, correct
   parent wait/idle behavior and one integrated result; parent abort
   follows the chosen ownership boundary.
6. **[ ] Step 6 — use wake as scheduling data** (`fleet-worker` host,
   then Suspenders adapter; after 3). Use durable sleeps/signals for Pi
   work and deduplicate webhook/assignment kicks by event ID in a
   journal document; keep a bounded reconciliation timer for missed
   external events. On a persistent Bun host, use Pi's timers. If the
   host is evictable, use `onWake`/`wake()` to arm one serialized alarm
   at the earliest sleep or active-work recovery heartbeat; arm before
   admission/resume, reopen on storage failure, and tolerate early or
   duplicate alarms. Outside-process host/lane health stays separate.
   **Exit:** idle work sleeps without periodic lane probes, an admitted
   assignment wakes promptly, and eviction, storage failure and early
   alarms neither strand nor duplicate it. `onWake` cannot see a job
   not yet admitted to Pi; its external assignment event must reach
   the host first.
7. **[ ] Step 7 — publish a faithful read model** (`fleet-worker`
   read API and Suspenders aggregation as separate items; after 3–6).
   Project `watchTaskGraph()`, `inspect()` blocked reasons, full
   `onReport` metadata and conversation views into versioned job
   snapshots and a bounded event stream. Join by stable job and
   conversation IDs, not lane name or PR-title substring. Show
   owner/child edges, `pending|running|sleeping|waiting|completing`,
   wake deadline, background/abort flags and last progress. Live graph
   nodes disappear at termination, so bank terminal receipts and
   journal entry cursors separately. On reconnect send a snapshot then
   ordered changes; page older transcript entries and repair gaps
   instead of scanning a fixed first page. **Exit:** an operator can
   distinguish claimed, process-live, transcript-active, waiting,
   blocked and productively finished work; reconnect and worker loss
   neither fabricate zero usage nor erase the terminal outcome.
8. **[ ] Step 8 — build the UI from Pi's typed view structures**
   (GUI owner in its own client surface; after 7). Amend
   `tasks/gui-brief.md` before implementation: retain its uniform
   layer registry, vanilla DOM, tokenized CSS, glyph+word states,
   server-side credentials and read-mostly API boundary. Add optional
   snapshot+subscribe semantics to a layer so live Pi changes do not
   require high-frequency polling; retain a polling fallback for health
   and non-streaming services. Render four reusable view templates from
   versioned data, never bespoke wiring: **job list** (placement,
   owner, epoch and last progress), **job detail** (Pi task/child tree,
   waits and wake time), **conversation** (windowed transcript with
   load-earlier/gap recovery), and **outcome** (test, PR, usage, effect
   receipts and provenance). Pi `ConversationView`, `TaskGraph`, typed
   documents and `ConversationTranscript` are the data structures to
   adapt; they are not a ready-made UI framework. The
   [Cloudflare Activity panel](https://github.com/earendil-works/pi-durable-cloudflare/blob/main/src/client/ActivityPanel.tsx)
   is a behavior reference, not a React dependency. Every operator
   action is a declared API command with auth, epoch, idempotency key,
   acknowledgement and visible result; a successful click does not
   optimistically mean `done`. **Exit:** one dead layer degrades only
   itself; restart/reconnect preserves selection and transcript
   continuity; the UI shows a parent, background child, blocked task,
   sleeping retry and terminal job correctly, with keyboard and
   screen-reader coverage.
9. **[ ] Step 9 — integrated failure proof and rollout** (each owner
   verifies its contract; after 1–8). Run hermetic crash tests at
   creation, submission, child spawn, GitHub effect, gate, report and
   cancel; include lost/duplicate wakes, closed harness and stale
   epochs. Repeat the eight-lane VMSS recovery on a pinned _new_ image
   against the original persistent journals and workspaces, with an
   actual in-flight interruption, identical conversation IDs, one PR
   comment from pi: agreed, and the existing 8-lane receipt (16 tasks, task-16 attempt-2) does NOT satisfy this step — old/new digests were identical, so cross-image journal compat is untested, and one supervisor container owning N clone lanes is a documented deviation, not the goal state. The step-9 run needs: pinned new image, original journals/workspaces (not a wiped store), a real mid-flight docker stop, and the claims split (container-replacement vs VMSS reimage vs multi-host) kept separate.
   per issue and board/task-graph receipts. Keep container replacement,
   VMSS reimage/host loss and multi-host failover as separate claims.
   Record source SHA, Pi package/image digests, journal schema and
   migration, runner backend, timestamps and rollback. Deploy one
   placement authority at a time; retain the old image/journal reader
   until migration and rollback are proven. **Exit:** API and UI show
   the same terminal outcomes after crash and restart, with no
   duplicate unsafe effect or lost child.

Step 1 lands before the new behavior slices. Step 2's data-loss repair
is the first executable safety fix within that structure. Steps 7 and
8 consume versioned contracts and can be developed separately after
Steps 3–6 provide real data. Do not mark P6 done on a green unit suite
or a queue-level PR receipt; require Step 9's crash and operator-view
evidence.
