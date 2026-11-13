// playwright.config.ts — the ROOT test tree. @playwright/test only,
// organized as PROJECTS in run order:
//   1. smoke    — docker engine running; the correct versions of the 3
//                 buckles running (full stack, this build); they are
//                 healthy — via the fleet-health SIDECARS, never the
//                 processes themselves.
//   2. e2e      — the MITM loop + the federation matrix (the test flow).
//   3. federation — per-hop grant edges + denial paths (subset of e2e,
//                 split for sharded runs).
//   4. load    — the rpm waves (429/503 + Retry-After). The waves are
//                 loops INSIDE the spec — no repeatEach: one run of the
//                 project is the load proof. Target it deliberately:
//                 bun --bun playwright test --project=load
//   5. rolling — the rolling deploy: v2 up behind the front, gated by
//                 its own sidecar, state-file flip under load, v1
//                 drained — zero dropped requests through the front.
// The stack rides a worker-scoped docker fixture (test/kit) — docker
// only, no local mode; compose is the topology of record.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { trace: "on-first-retry" },
  workers: 1,
  globalSetup: "./test/global-setup.ts",
  globalTeardown: "./test/global-teardown.ts",
  projects: [
    { name: "smoke", testMatch: "**/smoke/*.spec.ts" },
    { name: "e2e", testMatch: "**/e2e/*.spec.ts", dependencies: ["smoke"] },
    {
      name: "federation",
      testMatch: "**/federation/*.spec.ts",
      dependencies: ["smoke"],
    },
    {
      name: "load",
      testMatch: "**/load/*.spec.ts",
      dependencies: ["smoke"],
      retries: 0,
    },
    {
      name: "rolling",
      testMatch: "**/rolling/*.spec.ts",
      dependencies: ["smoke"],
    },
  ],
});
