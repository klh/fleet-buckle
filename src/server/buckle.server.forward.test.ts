// buckle.server.forward.test.ts — the MITM loop: POST
// /v1/chat/completions forwards to the engine (the unit's litellm);
// the W3C trace CONTINUES (same trace id on the engine hop); unknown
// model → problem+json 404; every request bumps /metrics. Worlds ride
// the kit (never hand-rolled) and every response parses through its
// wire schema (never hand-cast).
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  bootBuckle,
  mintKeyDir,
  stubEngine,
  stubProvider,
  type AccessRegistry,
} from "./buckle.server.kit.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleProblem } from "../schemas/buckle.problem.zod.ts";

const DIR = mintKeyDir({ "principal.wire@fleet.test.key": "bksk_wire_test" });
const AUTH = { authorization: "Bearer bksk_wire_test" };
const ACCESS: AccessRegistry = BuckleAccessRegistry.parse({
  principals: [{ id: "wire@fleet.test", kind: "service", groups: [] }],
  grants: [{ principal: "wire@fleet.test", scopes: ["models.list", "models.use"] }],
  tiers: [],
});

/** the engine's echo RESPONSE — parsed, never hand-cast (zod law) */
const EchoBody = z.object({ id: z.string() }).passthrough();

/** what we saw ARRIVE at the engine (the forwarded request) */
const ForwardedChat = z.object({ model: z.string() }).passthrough();

const CHAT = {
  model: "openrouter/qwen3-coder",
  messages: [{ role: "user", content: "hi" }],
};

/** one world: provider + engine stubs owned by the caller */
async function booted() {
  const provider = stubProvider([{ id: "openrouter/qwen3-coder" }]);
  const engine = stubEngine();
  const world = await bootBuckle({
    label: "b1",
    dir: DIR,
    access: ACCESS,
    providers: { openrouter: `http://127.0.0.1:${provider.port}` },
    hubs: {},
    engineUrl: `http://127.0.0.1:${engine.port}`,
  });
  return { world, base: world.base, engine, provider };
}

async function chat(base: string, model = CHAT.model): Promise<Response> {
  return fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH },
    body: JSON.stringify({ ...CHAT, model }),
  });
}

describe("the MITM forward loop", () => {
  test("forwards to the engine; the W3C trace CONTINUES onto the hop", async () => {
    const { world, base, engine } = await booted();
    try {
      const inbound = "00-1234567890abcdef1234567890abcdef-fedcba9876543210-01";
      const r = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", traceparent: inbound, ...AUTH },
        body: JSON.stringify(CHAT),
      });
      expect(r.status).toBe(200);
      const body = EchoBody.parse(await r.json());
      expect(body.id).toBe("engine-echo"); // passthrough, not rewritten
      // same trace id, new span id — continued, never re-minted
      const got = engine.seen[0]?.traceparent ?? "";
      expect(got.split("-")[1]).toBe("1234567890abcdef1234567890abcdef");
      expect(got.split("-")[2]).not.toBe("fedcba9876543210");
      const seen = ForwardedChat.parse(JSON.parse(engine.seen[0]?.raw ?? "{}"));
      expect(seen.model).toBe("openrouter/qwen3-coder");
    } finally {
      world.stop();
      engine.stop();
    }
  });

  test("unknown model → problem+json 404 (drift fails LOUD)", async () => {
    const { world, base, engine } = await booted();
    try {
      const r = await chat(base, "nope/nothing");
      expect(r.status).toBe(404);
      expect(r.headers.get("content-type")).toContain("application/problem+json");
      const problem = BuckleProblem.parse(await r.json());
      expect(problem.kind).toBe("not-found");
      expect(engine.seen.length).toBe(0); // never reached the engine
    } finally {
      world.stop();
      engine.stop();
    }
  });

  test("/metrics (Prometheus text) counts requests per model", async () => {
    const { world, base, engine } = await booted();
    try {
      for (let i = 0; i < 2; i++) expect((await chat(base)).status).toBe(200);
      const m = await fetch(`${base}/metrics`);
      expect(m.status).toBe(200);
      expect(m.headers.get("content-type")).toContain("text/plain");
      const text = await m.text();
      expect(text).toContain(
        'buckle_requests_total{buckle="b1",model="openrouter/qwen3-coder"} 2',
      );
    } finally {
      world.stop();
      engine.stop();
    }
  });
});
