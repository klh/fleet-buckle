# CONTROL-PLANE GAPS — the road to "no az / no ssh / no PAT for humans"

Target access model: humans authenticate via Entra (AD RBAC), repos via
GitHub identity, model seats via Copilot-tier AIC tokens, and ALL
agentic + model traffic rides the unified proxy (buckle→litellm).
This ledger records every place operations STILL require raw
`az`/ssh/PAT/docker access — each entry is a fleet surface to build.
Found live during the flock bring-up (2026-11-25).

## The ledger

| # | operation I did via escape hatch | how it was done | the fleet surface it needs | state |
|---|---|---|---|---|
| 1 | mint review tasks (10-lane launch) | ssh + `docker exec` + supervisor token file | authenticated `POST /tasks` through the public front (Entra RBAC → GUI BFF → supervisor) | **gap — blocked a live launch** |
| 2 | read supervisor board/reports | ssh + curl + token | done: GUI `/api/runners|factory|work-items` through the container app | ✅ live |
| 3 | read lane journals / settle errors | ssh + `docker cp` sqlite + strings | journal projection face (per-task entries, the workbench contract) | partial (workbenches = task-level only) |
| 4 | mint principal/engine keys | `docker exec cat` + file copy | gate `POST /admin/keys` EXISTS (admin scope) — unreachable (VNet-internal) + flock over-layer broken | **gap** |
| 5 | edit hub settings (timeouts, lanes) | ssh + python file rewrite | gate `POST /admin/hubs` EXISTS (writes the over layer, live swap) — same reachability + over-layer state | **gap** |
| 6 | regenerate engine config | hand-edit yaml on VM (wrong) | CI job running `buckle.gen-engine-config.ts --real` on catalog change | **gap — drift risk, happened** |
| 7 | update deployed images | ssh + docker pull/tag + compose recreate | a deploy pipeline (CI → registry digest pin → VM agent pulls) | **gap — done by hand all day** |
| 8 | read container logs | ssh + docker logs | GUI logs face (gate/engine passthrough) — live for gate; engine/supervisor logs need faces | partial |
| 9 | health / liveness | ssh + curl healthz | health sidecar :4112 + GUI status page | ✅ live (sidecar) |
| 10 | reset/retry failed tasks | sqlite UPDATE on the VM (raw SQL!) | supervisor `POST /retry-failed` + `POST /close` — EXIST, unreachable | **gap — raw SQL was used** |
| 11 | supervisor config (watch repo, max lanes) | compose env edits via ssh | a settings face or GitOps (compose in git, agent applies) | **gap** |
| 12 | VM sizing / network (NAT, NSG, Bastion) | `az` CLI + PIM | platform-team automation; humans never touch | accepted (infra owner) |

## The pattern behind the gaps

The fleet ALREADY has authorized write faces — `/admin/keys`,
`/admin/hubs`, `/tasks`, `/retry-failed`, `/close`, `/templates` —
but they live on the VNet-internal supervisor/gate ports. The only
public front today is the READ-only GUI container app. Closing the
model means ONE control front (AFD/WAF → GUI BFF write routes, Entra
JWT validated, RBAC scopes mapped to buck principal grants) with:

- **no docker/ssh on the path** — the BFF holds the supervisor token
  server-side (it already does for reads)
- **no raw SQL** — retry/close faces instead
- **no file edits on the VM** — `/admin/hubs` over-layer writes
- **no hand image ops** — digest-pinned deploys from CI

PIM/ssh remain break-glass only (platform-level incidents).
