// playwright.config.ts — the ROOT test tree. @playwright/test only,
// organized as projects: setup → smoke → e2e/federation/load.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { trace: "on-first-retry" },
  projects: [
    { name: "setup", testMatch: "**/setup/*.setup.spec.ts" },
    {
      name: "smoke",
      testMatch: "**/smoke/*.spec.ts",
      dependencies: ["setup"],
    },
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
      repeatEach: Number(process.env.BUCKLE_LOAD_REPEAT ?? 200),
      retries: 0,
    },
  ],
});
