# @fleet/buckle

The LLM MITM gateway: context injection, key management, tracking,
downstream federation, and the live overview — who is connected, where
work is taking place, tok/s per model/provider/buckle.

Everything forwards to the engine (litellm). Buckle touches only:
context injection, keys, tracking, federation. Read [AGENTS.md](AGENTS.md).

- **Config**: strictly JSON5 (`deploy/settings/*.settings.json5`), secrets
  are PATHS, models are FETCHED — never declared.
- **Schemas**: every shape is zod in `src/schemas/`; `openapi.json` is
  generated from them, committed, CI-diffed.
- **Tests**: colocated `*.test.ts` on bun test; `/test` runs
  @playwright/test projects (`smoke`, `e2e`, `federation`, `load`).
- **Demo**: `deploy/compose.test.yaml` boots 3 federated buckles
  (openrouter / ms copilot / zai) on Docker Desktop — the demonstrable
  matrix: alice sees b1 only; bob sees b1+b3; carol sees all.

## Setup

    npm install
    bun test                                  # colocated units
    bun --bun playwright test --project=smoke # root test tree
    bun run check                             # laws + openapi drift
    git config core.hooksPath .githooks       # qlty --fix pre-commit gate
