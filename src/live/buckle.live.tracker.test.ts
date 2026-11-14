// buckle.live.tracker.test.ts — the live overview: /v1/stats is
// grant-gated (stats.read); the forward loop RECORDS per-principal +
// per-model usage; inflight is true DURING a slow engine call. Worlds
// ride the kit; responses parse through BuckleStatsResponse.
import { describe, expect, test } from "bun:test";
import {
  bootBuckle,
  mintKeyDir,
  stubEngine,
  stubProvider,
  type AccessRegistry,
} from "../kit.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleStatsResponse } from "../schemas/buckle.stats.zod.ts";
import { TrackedPrincipalState } from "./buckle.live.tracker.ts";

const DIR = mintKeyDir({ "principal.wire@fleet.test.key": "bksk_wire_test" });
const AUTH = { authorization: "Bearer bksk_wire_test" };
const ACCESS: AccessRegistry = BuckleAccessRegistry.parse({
  principals: [{ id: "wire@fleet.test", kind: "service", groups: [] }],
  grants: [
    { principal: "wire@fleet.test", scopes: ["models.list", "models.use", "stats.read"] },
  ],
  tiers: [],
});

const CHAT = {
  model: "openai/live-test",
  messages: [{ role: "user", content: "hi" }],
};

async function booted(engineSleepMs = 0) {
  const engine = stubEngine({ sleepMs: engineSleepMs });
  const provider = stubProvider([{ id: "openai/live-test" }]);
  const world = await bootBuckle({
    label: "b1",
    dir: DIR,
    access: ACCESS,
    providers: { openrouter: `http://127.0.0.1:${provider.port}` },
    hubs: {},
    engineUrl: `http://127.0.0.1:${engine.port}`,
  });
  return {
    world,
    base: world.base,
    engine,
    provider,
    stop: () => {
      world.stop();
      engine.stop();
      provider.stop();
    },
  };
}

async function chat(base: string): Promise<Response> {
  return fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH },
    body: JSON.stringify(CHAT),
  });
}

describe("the tracked row (the tracker's contract)", () => {
  test("kind optional, everything else always-known, strict", () => {
    const base = { inflight: 0, requests: 0, connected_since: 1, last_seen: 1 };
    expect(TrackedPrincipalState.safeParse(base).success).toBe(true);
    expect(TrackedPrincipalState.safeParse({ ...base, kind: "agent" }).success).toBe(true);
    expect(TrackedPrincipalState.safeParse({ ...base, kind: "robot" }).success).toBe(false);
    expect(TrackedPrincipalState.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe("the live overview", () => {
  test("/v1/stats needs stats.read (grant-gated)", async () => {
    const { base, stop } = await booted();
    try {
      expect((await fetch(`${base}/v1/stats`)).status).toBe(401);
      const r = await fetch(`${base}/v1/stats`, { headers: AUTH });
      expect(r.status).toBe(200);
      const stats = BuckleStatsResponse.parse(await r.json());
      expect(stats.self.hub).toBe("b1");
      expect(stats.peers).toEqual({});
    } finally {
      stop();
    }
  });

  test("two chats → principal row requests=2, inflight back to 0", async () => {
    const { base, stop } = await booted();
    try {
      expect((await chat(base)).status).toBe(200);
      expect((await chat(base)).status).toBe(200);
      const stats = BuckleStatsResponse.parse(
        await (await fetch(`${base}/v1/stats`, { headers: AUTH })).json(),
      );
      const row = stats.self.principals.find(
        (p) => p.principal === "wire@fleet.test",
      );
      expect(row?.requests).toBe(2);
      expect(row?.inflight).toBe(0);
      expect(row?.last_seen).toBeGreaterThan(0);
      const model = stats.self.models.find((m) => m.model === "openai/live-test");
      expect(model?.inflight).toBe(0);
      expect(model?.tps).toBeGreaterThanOrEqual(0); // tokens counted live
    } finally {
      stop();
    }
  });

  test("inflight is TRUE during a slow engine call", async () => {
    const { base, stop } = await booted(400);
    try {
      const inflight = chat(base); // 400ms engine call
      await Bun.sleep(100);
      const stats = BuckleStatsResponse.parse(
        await (await fetch(`${base}/v1/stats`, { headers: AUTH })).json(),
      );
      expect(
        stats.self.models.find((m) => m.model === "openai/live-test")?.inflight,
      ).toBe(1);
      expect(
        stats.self.principals.find((p) => p.principal === "wire@fleet.test")
          ?.inflight,
      ).toBe(1);
      expect((await inflight).status).toBe(200);
    } finally {
      stop();
    }
  });
});
