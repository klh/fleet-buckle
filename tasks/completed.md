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
