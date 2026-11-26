# @fleet/buckle

The LLM MITM gateway: context injection, key management, tracking, downstream federation, and the
live overview — who is connected, where work is taking place, tok/s per model/provider/buckle.

Everything forwards to the engine (litellm). Buckle touches only: context injection, keys, tracking,
federation. Read [AGENTS.md](AGENTS.md).

- **Config**: strictly JSON5 (`deploy/settings/*.settings.json5`), secrets are PATHS, models are
  FETCHED — never declared.
- **Schemas**: every shape is zod in `src/schemas/`; `openapi.json` is generated from them,
  committed, CI-diffed.
- **Tests**: colocated `*.test.ts` on bun test; `/test` runs @playwright/test projects (`smoke`,
  `e2e`, `federation`, `load`).
- **Demo**: `test/deploy/compose.test.yaml` boots 3 federated buckles (openrouter / ms copilot /
  zai) on Docker Desktop — the demonstrable matrix: alice sees b1 only; bob sees b1+b3; carol sees
  all.

## Documentation map

- [Delivery plan](tasks/plan.md): task ownership, dependencies, gateway requirements and Worker
  links.
- [AGENTS.md](AGENTS.md): repository laws and session instructions.
- [Test operations](docs/test-flow.md): actual project names, fixtures and rig boundaries.
- [BYOC evidence](docs/byoc-verification.md): dated test receipts; human rollout is D01.
- [Context injection](docs/context_injection.md): implemented decision seam and known gaps.
- [Deploy HOWTO](docs/HOWTO_DEPLOY.md): the proven Azure VM shape — models, Gondolin on
  libkrun, the gotchas paid for in blood.
- [Control-plane gaps](docs/CONTROL-PLANE-GAPS.md): the road to "no az/ssh/PAT for
  humans" — every escape hatch mapped to the fleet surface it needs.
- [Decisions](docs/decisions/): config, module, federation and telemetry constraints.
- GUI design and implementation belong to [fleet-buckle-gui](../fleet-buckle-gui/plan.md). Runtime
  execution, seeds and recovery belong to [fleet-worker](../fleet-worker/plan.md).

## Setup

    bun install --frozen-lockfile
    bun test                                  # colocated units
    bun --bun playwright test --project=smoke # root test tree
    bun run check                             # laws + openapi drift
    git config core.hooksPath .githooks       # qlty --fix pre-commit gate
