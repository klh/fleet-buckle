// Project dependencies boot and stop the shared Docker stack. Azure and
// stage0 own isolated topologies and do not run that setup project.
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
  projects: [
    { name: "unit", testDir: "./src", testMatch: "**/*.spec.ts" },
    { name: "stack-setup", testMatch: "**/setup/stack.setup.ts", teardown: "stack-teardown" },
    { name: "stack-teardown", testMatch: "**/setup/stack.teardown.ts" },
    { name: "smoke", testMatch: "**/smoke/buckle.smoke.spec.ts", dependencies: ["stack-setup"] },
    { name: "stage0", testMatch: "**/smoke/buckle.smoke.stage0.spec.ts" },
    {
      name: "e2e",
      testMatch: "**/e2e/*.spec.ts",
      testIgnore: "**/e2e/buckle.e2e.azure.spec.ts",
      dependencies: ["smoke"],
    },
    // the azure tabula-rasa rig SELF-COMPOSES (its own compose file,
    // minted keys, stub seat) — no global-stack dependency
    { name: "azure", testMatch: "**/e2e/buckle.e2e.azure.spec.ts" },
    // the single serialized graph: stack-setup -> graph-setup (pinned worker
    // image + bounded readiness) -> graph flows -> graph-teardown. The live
    // VMSS canary is NOT here: it is an explicit opt-in project (separate).
    {
      name: "graph-setup",
      testMatch: "**/setup/graph.setup.ts",
      dependencies: ["stack-setup"],
      teardown: "graph-teardown",
    },
    { name: "graph-teardown", testMatch: "**/setup/graph.teardown.ts" },
    { name: "graph", testMatch: "**/setup/graph.*.spec.ts", dependencies: ["graph-setup", "smoke"] },
    // opt-in live canary: only runs when named (--project=canary) and
    // BUCKLE_CANARY=1; no dependencies, not in the hermetic graph
    { name: "canary", testMatch: "**/setup/*.canary.ts" },
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
