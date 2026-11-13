// buckle.server.forward.test.ts — STEP 3 (test-first): the MITM loop.
// POST /v1/chat/completions forwards to the engine (the unit's litellm);
// the W3C trace CONTINUES (same trace id on the engine hop); unknown
// model → problem+json 404; every request bumps /metrics (Prometheus).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootServer } from "./buckle.server.main.ts";
import { loadSettings } from "./buckle.server.settings.ts";
import { BuckleProblem } from "../schemas/buckle.problem.zod.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** the engine stub: echoes what it received (headers we assert on) */
function stubEngine(): { port: number; stop: () => void; seen: { traceparent: string | null; body: unknown }[] } {
  const seen: { traceparent: string | null; body: unknown }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      seen.push({
        traceparent: req.headers.get("traceparent"),
        body: await req.json().catch(() => null),
      });
      return Response.json({
        id: "engine-echo",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
      });
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true), seen };
}

function stubProvider(): { port: number; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      if (new URL(req.url).pathname === "/v1/models")
        return Response.json({ data: [{ id: "openrouter/qwen3-coder" }] });
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
      engine: { url: `http://127.0.0.1:${enginePort}` },
      providers: { openrouter: { url: `http://127.0.0.1:${providerPort}` } } as never,
    },
    port: 0,
  });
  return { server, base: `http://127.0.0.1:${server.port}` };
}

const CHAT = {
  model: "openrouter/qwen3-coder",
  messages: [{ role: "user", content: "hi" }],
};

describe("STEP 3 — the MITM forward loop", () => {
  test("forwards to the engine; the W3C trace CONTINUES onto the hop", async () => {
    const engine = stubEngine();
    const provider = stubProvider();
    const { server, base } = await booted(engine.port, provider.port);
    try {
      const inbound = "00-1234567890abcdef1234567890abcdef-fedcba9876543210-01";
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", traceparent: inbound },
        body: JSON.stringify(CHAT),
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { id: string };
      expect(body.id).toBe("engine-echo"); // passthrough, not rewritten
      // same trace id, new span id — continued, never re-minted
      const got = engine.seen[0]?.traceparent ?? "";
      expect(got.split("-")[1]).toBe("1234567890abcdef1234567890abcdef");
      expect(got.split("-")[2]).not.toBe("fedcba9876543210");
      expect((engine.seen[0]?.body as { model: string }).model).toBe(
        "openrouter/qwen3-coder",
      );
    } finally {
      engine.stop();
      provider.stop();
      server.stop(true);
    }
  });

  test("unknown model → problem+json 404 (drift fails LOUD)", async () => {
    const engine = stubEngine();
    const provider = stubProvider();
    const { server, base } = await booted(engine.port, provider.port);
    try {
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...CHAT, model: "nope/nothing" }),
      });
      expect(r.status).toBe(404);
      expect(r.headers.get("content-type")).toContain("application/problem+json");
      const problem = BuckleProblem.parse(await r.json());
      expect(problem.kind).toBe("not-found");
      expect(engine.seen.length).toBe(0); // never reached the engine
    } finally {
      engine.stop();
      provider.stop();
      server.stop(true);
    }
  });

  test("/metrics (Prometheus text) counts requests per model", async () => {
    const engine = stubEngine();
    const provider = stubProvider();
    const { server, base } = await booted(engine.port, provider.port);
    try {
      for (let i = 0; i < 2; i++) {
        const r = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(CHAT),
        });
        expect(r.status).toBe(200);
      }
      const m = await fetch(`${base}/metrics`);
      expect(m.status).toBe(200);
      expect(m.headers.get("content-type")).toContain("text/plain");
      const text = await m.text();
      expect(text).toContain(
        'buckle_requests_total{buckle="b1",model="openrouter/qwen3-coder"} 2',
      );
    } finally {
      engine.stop();
      provider.stop();
      server.stop(true);
    }
  });
});
