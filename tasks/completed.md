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
