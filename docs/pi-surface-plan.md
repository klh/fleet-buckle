# Pi surface adoption plan (pi 1.6.1 / pi-durable 1.6.0)

Mirror of `fleet-worker/docs/pi-surface-plan.md` (canonical); the other fleet repos mirror it
(like the shared AGENTS.md map). Source read in full: docs.pi.dev/latest, 2026-11-27.
This file is the **adoption map** for pi surfaces. It creates no card IDs and does not
modify any repo's dependency graph; binding delivery scope stays in each repo's
`plan.md`. Workers/implementers: treat the acceptance lines as each item's gate.

## Why

Lanes die from context bloat and unhandled provider errors; they have no cheap
classifier; client identity at the gateway is implicit; the GUI invents runner data
shapes because nothing published pi's. Every fix below is a pi surface we already ship.

## Adoption matrix

| Surface | worker (seed/supervisor) | gui | buckle | belt | skills |
|---|---|---|---|---|---|
| codemode | ✅ enable in seed | — | — | classifier target | document |
| decision models (`models.classify`) | ✅ register belt as provider | — | pass-through only | ✅ expose System One | — |
| compaction (settings + hook) | ✅ overrides + charter-summary hook | — | — | — | — |
| virtual models | ✅ prefer-ladder router (W20 nod) | — | — | — | — |
| `before_provider_headers` | ✅ lane attribution headers | — | require/read, never invent | — | — |
| rpc / rpc-commands | ✅ spawn lanes as RPC children | — | — | — | — |
| json (delta wire, `agent_settled`) | consume | ✅ mirror contract | — | — | — |
| rpc-extension-ui | ✅ policy approvals for lanes | operator nudge UI | — | — | — |
| session-format | `get_entries?since` cursor | runner-detail data shapes | — | — | — |
| watch-shaped ops (pi-durable) | authorize | ✅ WS projection | — | — | — |
| skills/packages/mcp | seed install via `pi install` | — | — | — | ✅ publish as package |
| containerization (Gondolin pattern) | guest tool routing (existing) | — | credential caveat rows | — | — |

## Tier 1 — seed changes (fleet-worker)

1. **Enable codemode**: seed `settings.json` `"defaultTools": ["+codemode"]`.
   *Accept:* a lane runs a parallel multi-tool script and output stays under budget.
2. **Belt decision model**: seed `models.json` provider `belt` → belt System One
   endpoint, `typesafe-system-one` compat; classifier listed via
   `models.getAvailableOfType("classifier")`. Depends on belt issue (below).
   *Accept:* `models.classify()` answers a choice question inside a lane.
3. **Compaction**: per-model `reserveTokens`/`keepRecentTokens` in seed settings;
   `session_before_compact` extension prepends the standing mission summary.
   *Accept:* a lane survives a long run without model_error; summary names the mission.
4. **Attribution headers**: `before_provider_headers` stamps `x-session-id`
   (PI_SESSION_ID) and lane id on every provider request. *Accept:* buckle/evidence
   can attribute a request to a lane without guessing.
5. **Virtual-model prefer router**: registers `router/pick` implementing the
   `.prefer` ladder (sticky previous/failed, retry → next entry). **Needs Worker-owner
   nod** — touches W20 model-policy. *Accept:* forced 429 on first ladder entry
   routes to second with cache-valid sticky continuation.

## Tier 2 — supervisor control (fleet-worker)

- Spawn lanes as `pi --mode rpc` children: `get_state`, `get_session_stats`
  (`contextUsage.percent`) for stall/over-context detection, `compact`, `abort`;
  `bash` command with streamed output replaces docker-exec script probes.
- Policy approvals for lane dialogs via the extension-UI subprotocol.
- `get_entries?since=<entryId>` for bounded transcript tailing.

## Tier 3 — GUI (fleet-buckle-gui)

- WS projection consumes worker-authorized watch-shaped ops (pi-durable
  `watch()`/`observeTaskGraph()`): delta records, bounded windows, reconnect+gap.
- `agent_settled` (never `agent_end`) drives runner state.
- Runner-detail tabs render pi's canonical shapes: transcript window, task graph,
  tool executions — stop inventing projections.

## Tier 4 — gateway (fleet-buckle)

- Never reimplement engine faces; pi changes the client side only.
- Accept/read `x-session-id` attribution; grant `stats.read` to the worker principal
  (observed 403 `worker@azure lacks stats.read` 2026-11-27 — GUI usage/requests panels
  empty because of it).
- `models-configuration compat` is B03 wire-qualification reference material.

## belt (fleet-belt)

- Serve System One behind the `typesafe-system-one` API contract pi expects
  (E-BELT scope); decision models natively, chat models excluded.

## fleet-skills

- Publish as a pi package (`pi install git:klh/fleet-skills@v<semver>`); seeds install
  skills via package declaration instead of file copies. Manifest filters per seed.

## The work loop (dogfood experiment)

1. **Pick** task(s) from a repo plan → understand entailment + cross-repo
   dependencies → **mint a GitHub issue** (Goal / Dependencies / Acceptance /
   Files-allowed). No issue without a stated acceptance gate.
2. **Lanes**: each repo's armed watcher fans out sub-agents on new open issues;
   models ride the azure-first ladder (`azure/gpt-6.1-sol` first). One issue → one
   lane unless the issue names parallel leaves.
3. **Monitor**: GUI `work-items` + `runner-activity` faces; `POST /retry-failed`
   for requeues; human checkpoint on every PR.

### Event-plane prerequisites (proposals for the Worker owner to card)

- **E1** `events.v1` contract + Absurd event-queue emitter (task-error, stall,
  lane-death, gateway-503-burst) — emitted at existing supervisor write points.
- **E2** non-LLM dispatcher: event record → `harness.signal()` / write-submission to
  the armed runner (pi-durable primitives; duplicates closed).
- **E3** fleet-error watcher: armed on E2 deliveries; correlates across
  buckle/gui/worker; mints issues with embedded failure context.
- With E1–E3: loop (a) failure events wake the fleet-error supervisor; loop (b)
  minting an issue updates the repo plan and emits `events.v1 plan.updated` so the
  repo supervisor sees new work without polling. Until then, minting = GitHub issue
  + manual plan edit; watchers poll via the existing GitHub import sweep.

## Standing risks

- GitHub Actions billing is broken (gui/worker CI cannot publish images) — lane work
  is unaffected (PAT-driven), but seed/image deploys wait on billing.
- Every PR still needs the human checkpoint; watchers implement, owner merges.
