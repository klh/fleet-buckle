# Test operations

`playwright.config.ts` and `package.json` define executable projects and commands. The delivery plan
owns planned topology changes under B14; this page describes the current setup.

## Current projects

The shared Docker graph is `stack-setup` → `smoke` → `e2e`, `federation`, `load`, or `rolling`.
`stack-teardown` is the setup project's teardown. The `azure` and `stage0` projects own separate
stacks and do not depend on shared setup. `unit` selects `src/**/*.spec.ts`; existing colocated
`*.test.ts` run with `bun test`. Do not assume a file is selected merely because it has a test name.

```text
bun install --frozen-lockfile
bun run typecheck
bun run check
bun test
bun --bun playwright test --project=e2e
bun --bun playwright test --project=federation
bun --bun playwright test --project=azure
bun --bun playwright test --project=rolling
```

Choose only projects relevant to the change. Setup/teardown owns lifecycle. Do not run overlapping
stacks with shared project names, ports, keys or volumes. An interrupted run needs inspection of its
exact Compose project before cleanup; never delete a live deployment's state.

## Fixtures and engine configuration

Catalog fixtures live in `test/deploy/fixtures/`. The capture tool is
`tools/src/buckle.capture-fixtures.ts`; it reads machine-level credential paths. The engine
generator is `tools/src/buckle.gen-engine-config.ts`. The shared setup project generates engine
files from fixtures before boot; never hand-edit generated model rows or fabricate a live provider
receipt. Use independent stub observed-request/state oracles for assertions.

Stage 0 proves relay health and honest model failure without an engine. It is not model readiness.
The Azure-named project is a Docker test topology, not evidence of a deployed Azure service. Live
VMSS acceptance needs separate image/config and real model receipts from the plan.

## Rolling verification

`test/rolling/buckle.rolling.spec.ts` uses `test/deploy/compose.rolling.yaml` and `deploy/front/`.
The front reads its active target from a state file. Use a same-inode write on the mounted switch
file: replacing its inode can be hidden by VirtioFS. Qualify the candidate's independent probe and
version before switching, verify requests through the front during the switch, then drain the old
version. A passing rolling fixture does not prove long-lived streams or production rollback until
those acceptance cases are exercised separately.
