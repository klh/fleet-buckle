# Completed Buckle work — reviewed 2026-11-18

Reviewed source: `f290e1d`. Implementation completion and deployed qualification
are separate facts. [plan.md](plan.md) retains all outstanding package acceptance,
active source references and domain boundaries.

## B13 — Copied agent runtime removed

- **Completed:** `src/agents/` and its gateway configuration/caller integration were removed by `f4362fa` / PR #25. Current runtime source has no Pi AI/Durable imports or owned Pi journal/task scheduler.
- **Evidence:** reviewed tree/imports and removal commit; selected current gateway regression tests pass. Do not recreate this directory or follow the stale decomposition inventory's removal recipe.
- **Residual work moved to B15:** unused Pi `1.5.0` dependencies remain in `package.json`/lockfile; full gateway regression, forward Worker prerequisite acceptance and release qualification are open. B13 removal does not establish those gates.
- **References:** B13 dependencies in other cards resolve to this completed removal scope. B15/W19 retain combined qualification and retirement requirements.

## Other completed correction scope

| Completed scope                                                                              | Evidence                                                                                                                                       | Remaining acceptance                                                                                       |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| B04 revoked-principal denial at actual HTTP ingress and scoped engine-token selection (#29). | `src/access/buckle.access.registry.ts`, `src/main.test.ts`, passthrough scope tests; C561 confirms the reproduced ingress defect was repaired. | B04 still owns deployed two-boundary revocation, virtual keys/budgets, DB failure and BYOC isolation.      |
| B06/proxy correlation egress strip and OTLP byte regression (#28).                           | Current proxy/trace tests and golden-byte fixture.                                                                                             | This is neither independent trace decoding nor a real Pi→gateway→spend/terminal join. B06/W14 remain open. |
| Selected gateway mechanism regression baseline.                                              | Fresh `bun test src/access src/proxy src/catalog src/metrics src/trace`: **68 pass, 0 fail across 15 files**.                                  | Hermetic/stubbed cases do not close B03/B05/B06/B10/B11 or the combined release.                           |

## Open verification and deployed state

Fresh Playwright `--project=unit` fails discovery because schema `.spec.ts` files
import `bun:test`; no tests were executed by that project. B01/B14 retain this repair.
C561 reports deployed Buckle `807cf85`, predating current source. LiteLLM is config-only;
Lens, MCP and A2A have no qualified deployment. No B15 release qualification is claimed.
Local review logs: `/tmp/fb-plan-reconcile-unit.log`,
`/tmp/fb-plan-reconcile-mechanisms.log`, `/tmp/fb-plan-reconcile-ingress.log`.
Release receipts need published raw artifacts, not these temporary paths alone.

## Landed 2026-11-20 — VMSS engine/belt integration + models.use grant (verified same day)

| Landed scope | Evidence | Remaining |
| --- | --- | --- |
| Engine serves the belt-configured canary model row (`canary-chat`, Qwen3-0.6B via llama.cpp) — belt convergence output landed in the GENERATED engine yaml (never hand-edited). | compose service `canary-llm` + engine yaml row; completion verified through the engine AND through the gate lane path. | Belt service containerization (belt runs the convergence loop today via compose `belt`). |
| `gui@azure` granted `models.use` (the GUI chat wire 403 closed). | settings grants row + gate restart; root-wire completion with the gui principal returned the canary reply. | The gui playground still surfaces the seat-quota error for Copilot models — honest state until the seat resets. |
| Engine BELT_API_KEY env wired (litellm openai provider requires a non-empty key; llama-server ignores it). | compose engine environment; completion 500 → 200 verified. | — |
| Token throughput surfaced: gate `/v1/stats` `self.tps` (10s rolling window) exposed on the GUI usage/overview metrics. | Already-tracked `tps` in the stats face; gui consumes it. | Lane-traffic attribution per principal remains coarse. |

These are deployment/integration receipts, not B-card gate closures. B15/B15.1
gates remain as scoped.

## Landed 2026-11-26 — flock migration + interim-shape hardening (receipts, NOT gate closures)

The deployment moved subscription (cbf-imcdigitalassetsearch-prd →
cbrs-icomappstore-prd / rg-flock-nonprod) and hardened the interim
old-Supervisor shape per owner direction. These are deployment and
runtime receipts in this file's established pattern; **no B-card gate
is claimed closed by this table**. Interim architecture note: the
issue queue + spawn loop remain the retirement target per the plan's
vocabulary; this work hardens that interim, it does not replace W16.

| Landed scope | Evidence | Remaining |
| --- | --- | --- |
| VM `flock-runner-0` (Standard_D8as_v6, westeurope): full stack — gate, engine, supervisor/lanes, health; `/dev/kvm` verified, Gondolin on **libkrun** (`GONDOLIN_VMM=krun`, the krun-runner from `@earendil-works/gondolin-krun-runner-linux-x64`) — microVM boot + exec + clean close proven; **no QEMU anywhere**. | krun smoke test in the supervisor container (uname via guest); e2e issue→PR cycle (PR #123) ran through the stack. | krun activation is owner-directed; a bounded task + acceptance record for the deferred-infrastructure disposition is filed below. |
| Old-subscription teardown: VMSS, LB/NSG/vnet, both AOAI accounts, ACR deleted. Flock AOAI twins: 9 openai + 3 multi2 deployments at 500k TPM (capacity 500). | az resource lists empty on the old RG; catalog 112 rows through the gate. | Engine config on the VM remains hand-edited (0002 debt): regeneration through `buckle.gen-engine-config.ts --real` open. |
| Settings reconciliation in git: `deploy/settings/azure.settings.json5` now carries worker@azure principal + grants (models.use, gui engine.passthrough), the **engine-as-provider entry (label azure — the catalog source)**, `provider_fetch_ms: 200000` + `catalog_grace_ms: 3600000`, lanes. The over-layer env restored (`/admin/hubs` live again). | Gate /v1/models 112 rows both keys; /admin/hubs writes the over layer; cold-boot catalog no longer starves (the 1.5s default vs ~150s engine walk). | The serialized B02 integration-lane process was bypassed (session direct edits); the settings drift cost hours to rediscover — the lane discipline is the lesson. |
| NAT gateway `flock-natgw` (VM has NO public IP — org advisory; outbound SNAT via the NAT GW). GUI on a VNet-integrated Container App (`flock-gui`), external ingress, digest-pinned deploys. | VM outbound restored (was dead post-public-IP-removal); container app 200s. | AFD/WAF front pending platform hookup (blurb delivered); after AFD: lock container-app ingress to AFD ranges. |
| Worker runtime faces (from the fleet's own review lanes): lane journal read face (`GET /journal`), reports face carries notes, the agent's final answer rides the report note, submission-failure reasons surface, stable clone IDs (pickLaneId), claimNext respects task_deps, mint covers all states, retry cap = claim cap, doom-loop keeps workers_finish, /next parses the wire, red gates fail deliveries only. | fleet-worker commits 05bc60e..c569443; lane reviews (tasks 308-317) found the criticals; live re-runs verified. | The mind `once()` replay, guest isolation, stale-guest writes: filed as issues #249/#250/#251 (owner design needed). |
| GUI live bindings: schema'd supervisor client (src/api — the wire law), fan-out tree (supervisor lanes as roots, sub-agents parented by repo), runners capped at recent 15 settled, work inbox = active queue + 20 recent, factory wall with armed watchers, overview queue metrics, keys/teams via gate /admin/state, chat playground (model-id URL-decode fix), 16-test functional live e2e suite (project `live`, LIVE_GUI_BASE-gated). | Live suite green against the deployed container app; unit suite 97 green. | Keys page is roster visibility, not G12.2 (DB-backed key lifecycle = B04.2). |
| Templates: origin moved to `deploy/templates/` (fleet-buckle); the GUI consumes via the `@fleet/buckle` git dependency (`#main`, lockfile-frozen); frontmatter carries knob defaults (mirror of the worker's `SUPERVISOR_DEFAULTS`); 0 self-referential junk defaults. | Templates build consumes node_modules origin; fixture catalog 61/61 frontmatter. | The origin dependency needs CI-side auth (billing currently blocks builds — local build+push workaround in use). |
| `docs/CONTROL-PLANE-GAPS.md`: the ledger toward "no az/ssh/PAT for humans" — every escape hatch used today mapped to the fleet surface it needs. | The blocked 10-lane launch (task mint needed ssh+token) is entry #1. | All write faces remain VNet-internal; the control front is the AFD/APIM follow-up. |

### krun bounded-task record (deferred-infrastructure disposition)

Owner-directed activation of **krun/libkrun** on the flock VM,
2026-11-26: `GONDOLIN_VMM=krun` + the krun-runner binary + `/dev/kvm`
group wiring on the supervisor container. Acceptance evidence: the
in-container microVM boot/exec/close smoke test and the e2e
issue→PR cycle executed on the krun executor. QEMU is absent from the
exec path. Residual: the executor is `docker` by default in code;
the gondolin+krun path is a flock-deployment configuration, not a
default change.
