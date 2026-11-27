import { test as base, expect } from "@playwright/test";
import { join } from "node:path";
import { bootBuckle, mintKeyDir, ROOT } from "../kit.ts";
import { loadSettings } from "../settings.ts";
import { BuckleStatsResponse } from "../schemas/buckle.stats.zod.ts";
import { holdsScope } from "./buckle.access.registry.ts";

async function bootWorkerStats() {
  const settings = await loadSettings({
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, "deploy/settings/azure.settings.json5"),
  });
  const dir = mintKeyDir({ "principal.worker@azure.key": "bksk_test_worker" });
  const world = await bootBuckle({ label: "azure", dir, access: settings.access!, providers: {} });
  return { settings, ...world };
}

const test = base.extend<{ world: Awaited<ReturnType<typeof bootWorkerStats>> }>({
  world: async ({}, use) => {
    const world = await bootWorkerStats();
    await use(world);
    world.stop();
  },
});

test("Azure worker key can read schema-valid stats without broader privileges @unit", async ({ world, request }) => {
  const response = await request.get(`${world.base}/v1/stats`, {
    headers: { authorization: "Bearer bksk_test_worker" },
  });
  expect(response.status()).toBe(200);
  expect(BuckleStatsResponse.parse(await response.json()).self.hub).toBe("azure");
  for (const scope of ["models.list", "models.use", "stats.read"] as const)
    expect(holdsScope(world.settings, "worker@azure", scope)).toBe(true);
  for (const scope of ["admin", "tree.read", "engine.passthrough"] as const)
    expect(holdsScope(world.settings, "worker@azure", scope)).toBe(false);
});

test("unverified attribution cannot authorize stats @unit", async ({ world, request }) => {
  const response = await request.get(`${world.base}/v1/stats`, {
    headers: { "x-session-id": "worker@azure", "x-fleet-lane": "owner@azure" },
  });
  expect(response.status()).toBe(401);
});
