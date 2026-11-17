# The durable worker moved to `klh/fleet-worker`

**Status:** extraction complete (2026-11-16). This repo no longer carries
worker code, tests, seeds, or Dockerfiles. The last commit that touched
`deploy/worker/` here was `e72086d` (`.prefer` seed picker); the tree was
removed right after, and everything it did lives on — evolved — in the
worker repo.

## Where things went

| was here (fleet-buckle)                       | is now (fleet-worker)                            |
| --------------------------------------------- | ------------------------------------------------ |
| `deploy/worker/worker.durable.ts` (+9 files)  | `src/worker.*.ts` (split by responsibility)      |
| `deploy/worker/test/` (103 unit tests)        | `src/*.test.ts` (grown; gate tests included)     |
| `deploy/worker/seed/`                          | `seed/` (over-layer + templates)                 |
| `test/e2e/buckle.e2e.agent.spec.ts`            | `test/e2e/worker.cycle.spec.ts` (identical rig)  |
| `test/e2e/buckle.e2e.worker-prefer.spec.ts`    | `test/e2e/worker.prefer.spec.ts`                 |
| rig: worker3/worker4/gh-stub in compose.test    | rig: `test/deploy/compose.worker.yaml` (own ports 4731/4741/4742/4743) |
| `deploy/worker/Dockerfile`                     | `Dockerfile` (tool-seed: node tarball + nvm runtime) |

## Version matrix (the cross-repo contract)

Integration consumes **published immutable images + source SHAs** — never
a `latest` tag, never a cross-repo build.

| when        | fleet-buckle | fleet-worker | image (`fleetbuckle467.azurecr.io/worker`) | note                     |
| ----------- | ------------ | ------------ | ------------------------------------------ | ------------------------ |
| 2026-11-16  | `f6ff9da`    | `884f405`    | `worker:07a4ad3`                            | live on VMSS; live cycle proven (issue → worker → buckle → engine → seat → PR) |
| rollback    | `45cc66e`    | `e72086d`    | `worker:e72086d`                            | last in-repo build (pre-extraction) |

The VMSS compose pins `worker:07a4ad3` (see `deploy/compose.yaml` on the
hub). Rollback = repin to `worker:e72086d` and `git checkout e72086d` of
fleet-buckle's `deploy/worker/` (the tree still exists at that SHA).

## Why

The plan (`tasks/plan.md` P1.5) and the implementation contract
(`tasks/implementation-contract.md`) name the repo ownership: buckle is
the identity-aware MITM; **fleet-worker** owns sessions, seeds, tools,
journals, and runners. Two homes for one worker was migration debt —
this is the debt paid.
