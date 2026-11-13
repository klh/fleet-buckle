// buckle.server.live.test.ts — COMMIT 4 STEP 2 (test-first): the live
// overview. /v1/stats is grant-gated (stats.read); the forward loop
// RECORDS per-principal + per-model usage; inflight is true DURING a
// slow engine call; peers contribute (null when unreachable).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { bootServer } from "./buckle.server.main.ts";
import { loadSettings } from "./buckle.server.settings.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleStatsResponse } from "../schemas/buckle.stats.zod.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const KEYS_DIR = mkdtempSync(join(tmpdir(), "buckle-keys-"));
{
  const p = join(KEYS_DIR, "principal.wire@fleet.test.key");
  writeFileSync(p, "bksk_wire_test\n");
  chmodSync(p, 0o600);
}
const AUTH = { authorization: "Bearer bksk_wire_test" };

function stubEngine(sleepMs: number): { port: number; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch: async () => {
      await Bun.sleep(sleepMs);
      return Response.json({
        id: "engine-echo",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true) };
}

function stubProvider(): { port: number; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      if (new URL(req.url).pathname === "/v1/models")
        return Response.json({ data: [{ id: "openai/live-test" }] });
      return new Response("not found", { status: 404 });
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true) };
}

async function booted(enginePort: number, providerPort: number) {
  const base = await loadSettings({
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, "deploy/settings/b1.settings.json5"),
  });
  const server = bootServer({
    settings: {
      ...base,
      keys: { ...(base.keys ?? {}), principals_dir: KEYS_DIR },
      access: BuckleAccessRegistry.parse({
        principals: [{ id: "wire@fleet.test", kind: "service", groups: [] }],
        grants: [
          {
            principal: "wire@fleet.test",
            scopes: ["models.list", "models.use", "stats.read"],
          },
        ],
        tiers: [],
      }),
      hubs: {}, // no peers in this unit test
      engine: { url: `http://127.0.0.1:${enginePort}` },
      providers: { openrouter: { url: `http://127.0.0.1:${providerPort}` } },
    },
    port: 0,
  });
  return { server, base: `http://127.0.0.1:${server.port}` };
}

const CHAT = {
  model: "openai/live-test",
  messages: [{ role: "user", content: "hi" }],
};

async function chat(base: string): Promise<Response> {
  return fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH },
    body: JSON.stringify(CHAT),
  });
}

describe("COMMIT 4 STEP 2 — the live overview", () => {
  test("/v1/stats needs stats.read (grant-gated)", async () => {
    const engine = stubEngine(0);
    const provider = stubProvider();
    const { server, base } = await booted(engine.port, provider.port);
    try {
      expect((await fetch(`${base}/v1/stats`)).status).toBe(401);
      const r = await fetch(`${base}/v1/stats`, { headers: AUTH });
      expect(r.status).toBe(200);
      const stats = BuckleStatsResponse.parse(await r.json());
      expect(stats.self.hub).toBe("b1");
      expect(stats.peers).toEqual({});
    } finally {
      engine.stop();
      provider.stop();
      server.stop(true);
    }
  });

  test("two chats → principal row requests=2, inflight back to 0", async () => {
    const engine = stubEngine(0);
    const provider = stubProvider();
    const { server, base } = await booted(engine.port, provider.port);
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
      engine.stop();
      provider.stop();
      server.stop(true);
    }
  });

  test("inflight is TRUE during a slow engine call", async () => {
    const engine = stubEngine(400);
    const provider = stubProvider();
    const { server, base } = await booted(engine.port, provider.port);
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
      engine.stop();
      provider.stop();
      server.stop(true);
    }
  });
});
