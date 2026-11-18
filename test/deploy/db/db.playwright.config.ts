import { defineConfig } from "@playwright/test";
// standalone: no stack dependency. run: bunx playwright test -c test/deploy/db/db.playwright.config.ts
export default defineConfig({ testDir: ".", testMatch: "*.spec.ts", workers: 1, reporter: "list" });
