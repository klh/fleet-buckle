import { test as base } from "@playwright/test";
import { face } from "../kit/buckle.kit.health.ts";

export const test = base.extend<{ healthState: (port: number) => Promise<string> }>({
  healthState: async ({}, use) => {
    await use(face);
  },
});

export { expect } from "@playwright/test";
