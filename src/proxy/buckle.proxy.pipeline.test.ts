// buckle.proxy.pipeline.test.ts — the MITM loop: POST
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
  stubByocSeat,
  stubEngine,
  stubProvider,
  type AccessRegistry,
} from "../kit.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleProblem } from "../schemas/buckle.problem.zod.ts";
import { ServedOutcomeSchema } from "./buckle.proxy.pipeline.ts";

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
async function booted(opts: { sse?: string } = {}) {
  const provider = stubProvider([{ id: "openrouter/qwen3-coder" }]);
  const engine = stubEngine(opts.sse !== undefined ? { sse: opts.sse } : {});
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

describe("the served surface (the legs' shared contract)", () => {
  test("strict round-trip: the five fields, nothing more", () => {
    const served = ServedOutcomeSchema.parse({
      kind: "served",
      status: 200,
      text: "{}",
      contentType: "application/json",
      servedBy: "b1",
    });
    expect(served.servedBy).toBe("b1");
    expect(ServedOutcomeSchema.safeParse({ ...served, extra: true }).success).toBe(false);
  });
});

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
      expect(text).toContain('buckle_requests_total{buckle="b1",model="openrouter/qwen3-coder"} 2');
    } finally {
      world.stop();
      engine.stop();
    }
  });
});

/** the OpenAI Responses wire ask (the third dialect's shape) */
const RESPONSES_ASK = {
  model: "openrouter/qwen3-coder",
  instructions: "you are terse",
  input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
};

/** the seat's responses echo (what the BYOC leg relays back) */
const SeatEcho = z.object({ object: z.literal("response") }).passthrough();

/** one ride as the recorder saw it */
const Ride = z.object({ path: z.string(), auth: z.string().nullable(), raw: z.string() });

/** native Responses SSE bytes — the pass-through proof must see
 *  every byte back, in order */
const SSE_BYTES = [
  "event: response.created",
  'data: {"type":"response.created","response":{"id":"resp_1","model":"m"}}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","delta":"hel"}',
  "",
  "event: response.completed",
  'data: {"type":"response.completed","response":{"id":"resp_1","usage":{"total_tokens":7}}}',
  "",
  "",
].join("\n");

async function askResponses(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("the responses dialect (/v1/responses)", () => {
  test("rides the engine at /v1/responses, body verbatim, answer untouched", async () => {
    const { world, base, engine } = await booted();
    try {
      const r = await askResponses(base, RESPONSES_ASK);
      expect(r.status).toBe(200);
      expect(EchoBody.parse(await r.json()).id).toBe("engine-echo"); // the engine's answer, not rewritten
      expect(engine.seen.length).toBe(1);
      expect(engine.seen[0]?.path).toBe("/v1/responses"); // the dialect's engine leg
      const seen = ForwardedChat.parse(JSON.parse(engine.seen[0]?.raw ?? "{}"));
      expect(seen.model).toBe("openrouter/qwen3-coder");
      expect(seen["instructions"]).toBe("you are terse");
      expect(seen["input"]).toEqual(RESPONSES_ASK.input);
    } finally {
      world.stop();
      engine.stop();
    }
  });

  test("model-less and malformed bodies fail LOUD (problem+json 422, the validation kind)", async () => {
    const { world, base, engine } = await booted();
    try {
      for (const bad of [{ input: "hi" }, "not json"]) {
        const r = await askResponses(base, bad);
        expect(r.status).toBe(422);
        expect(r.headers.get("content-type")).toContain("application/problem+json");
        expect(BuckleProblem.parse(await r.json()).kind).toBe("validation");
      }
      expect(engine.seen.length).toBe(0); // never reached the engine
    } finally {
      world.stop();
      engine.stop();
    }
  });

  test("SSE answers pass through byte-identical (native dialect, no reframing)", async () => {
    const { world, base, engine } = await booted({ sse: SSE_BYTES });
    try {
      const r = await askResponses(base, { ...RESPONSES_ASK, stream: true });
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/event-stream");
      expect(await r.text()).toBe(SSE_BYTES); // every engine byte, in order
      expect(engine.seen[0]?.path).toBe("/v1/responses");
      expect(JSON.parse(engine.seen[0]?.raw ?? "{}").stream).toBe(true);
    } finally {
      world.stop();
      engine.stop();
    }
  });
});

describe("the BYOC /w/ lane on the responses dialect", () => {
  test("the caller's token relays the seat at /v1/responses (engineless unit)", async () => {
    const PAT = "ghp_" + "cccc4cccc4cccc4cccc4cccc4cccc4cccc4cccc";
    const seat = stubByocSeat([{ id: "mscopilot/gpt-6-astra" }]);
    const openrouter = stubProvider([{ id: "openrouter/qwen3-coder" }]);
    const world = await bootBuckle({
      label: "b1",
      dir: DIR,
      access: ACCESS,
      providers: {
        mscopilot: `http://127.0.0.1:${seat.port}`,
        openrouter: `http://127.0.0.1:${openrouter.port}`,
      },
      hubs: {},
      // engineless — the BYOC leg relays the seat DIRECT
    });
    try {
      const r = await fetch(`${world.base}/w/copilot/${PAT}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "mscopilot/gpt-6-astra", input: "hi" }),
      });
      expect(r.status).toBe(200);
      expect(SeatEcho.parse(await r.json()).object).toBe("response");
      const rides = Ride.array().parse(seat.seen.filter((s) => s.path === "/v1/responses"));
      expect(rides.length).toBe(1);
      expect(rides[0]?.auth).toBe(`Bearer ${PAT}`); // THEIR credential reached the seat
      expect(JSON.parse(rides[0]?.raw ?? "{}").model).toBe("mscopilot/gpt-6-astra");
    } finally {
      world.stop();
      seat.stop();
      openrouter.stop();
    }
  });
});
