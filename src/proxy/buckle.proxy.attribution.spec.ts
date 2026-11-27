import { test as base, expect } from "@playwright/test";
import { z } from "zod";
import { bootBuckle, mintKeyDir, recorder, stubEngine, stubProvider, stubByocSeat } from "../kit.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { relayHeaders } from "./buckle.proxy.passthrough.ts";
import cases from "./fixtures/attribution.json";

const AttributionCases = z.array(z.object({
  name: z.string(), headers: z.record(z.string(), z.string()),
  sessionId: z.string().nullable(), laneId: z.string().nullable(),
}));

async function bootWorld() {
  const dir = mintKeyDir({
    "principal.worker@azure.key": "bksk_test_worker",
    "peer-peer.token": "bksk_test_worker",
  });
  const access = BuckleAccessRegistry.parse({
    principals: [{ id: "worker@azure", kind: "service", groups: [] }],
    grants: [{ principal: "worker@azure", scopes: ["models.list", "models.use"], peers: ["peer"] }],
    tiers: [],
  });
  const engine = stubEngine({ sseChunks: ["data: test\n\n", "data: [DONE]\n\n"] });
  const provider = stubProvider([{ id: "test-model" }]);
  const seat = stubByocSeat([{ id: "seat-model" }]);
  const peer = await bootBuckle({ label: "peer", dir, access,
    providers: { openrouter: `http://127.0.0.1:${provider.port}` },
    engineUrl: `http://127.0.0.1:${engine.port}` });
  const rec = recorder(peer.port);
  const head = await bootBuckle({ label: "head", dir, access,
    providers: {}, hubs: { peer: `http://127.0.0.1:${rec.port}` } });
  const byoc = await bootBuckle({ label: "byoc", dir, access,
    providers: { mscopilot: `http://127.0.0.1:${seat.port}` } });
  const byocEngine = await bootBuckle({ label: "byoc-engine", dir, access,
    providers: { mscopilot: `http://127.0.0.1:${seat.port}` },
    engineUrl: `http://127.0.0.1:${engine.port}` });
  return { peer, head, byoc, byocEngine, engine, seat, rec,
    stop() { byocEngine.stop(); head.stop(); peer.stop(); byoc.stop(); rec.stop(); provider.stop(); engine.stop(); seat.stop(); } };
}

const test = base.extend<{ world: Awaited<ReturnType<typeof bootWorld>> }>({
  world: async ({}, use) => {
    const world = await bootWorld();
    await use(world);
    world.stop();
  },
});

for (const c of AttributionCases.parse(cases)) {
  for (const leg of ["hop", "engine", "byoc", "byoc-engine"] as const) {
    test(`${leg} carries optional attribution: ${c.name} @unit`, async ({ world, request }) => {
      const target = leg === "hop" ? world.head.base : leg === "engine" ? world.peer.base : `${(leg === "byoc" ? world.byoc : world.byocEngine).base}/w/test/caller-seat-token-for-test-42`;
      const body = JSON.stringify({ model: leg.startsWith("byoc") ? "seat-model" : "test-model", messages: [] });
      const response = await request.post(`${target}/v1/chat/completions`, {
        headers: { authorization: "Bearer bksk_test_worker", "content-type": "application/json", ...c.headers },
        data: body,
      });
      expect(response.status()).toBe(200);
      const saw = (leg === "byoc" ? world.seat.seen : world.engine.seen).at(-1);
      expect(saw?.raw).toBe(body);
      expect(saw?.sessionId).toBe(c.sessionId);
      expect(saw?.laneId).toBe(c.laneId);
      expect(saw?.auth).toBe(leg.startsWith("byoc") ? "Bearer caller-seat-token-for-test-42" : null);
      if (leg === "hop") {
        const hop = world.rec.seen.find((r) => r.raw === body);
        expect(hop?.sessionId).toBe(c.sessionId);
        expect(hop?.laneId).toBe(c.laneId);
        expect(hop?.auth).toBe("Bearer bksk_test_worker");
      }
    });
  }
  test(`pass-through preserves attribution: ${c.name} @unit`, () => {
    const headers = relayHeaders(new Request("http://example.test", { headers: c.headers }));
    expect(headers["x-session-id"] ?? null).toBe(c.sessionId);
    expect(headers["x-fleet-lane"] ?? null).toBe(c.laneId);
  });
}

test("streaming Messages carries attribution without changing SSE bytes @unit", async ({ world, request }) => {
  const body = JSON.stringify({ model: "test-model", messages: [], stream: true });
  const response = await request.post(`${world.head.base}/v1/messages`, {
    headers: { authorization: "Bearer bksk_test_worker", "content-type": "application/json",
      "x-session-id": "stream-session", "x-fleet-lane": "stream-lane" }, data: body,
  });
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe("data: test\n\ndata: [DONE]\n\n");
  expect(world.engine.seen.at(-1)?.sessionId).toBe("stream-session");
  expect(world.engine.seen.at(-1)?.laneId).toBe("stream-lane");
  expect(world.engine.seen.at(-1)?.raw).toBe(body);
});
