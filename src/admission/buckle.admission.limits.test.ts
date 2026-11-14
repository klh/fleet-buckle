// buckle.admission.limits.test.ts — the rate limiter: window math admits
// under the cap and denies past it (Retry-After), the window frees as
// timestamps age out, the ROUTE enforces (429 + Retry-After), and
// tiers fall back by principal KIND. Worlds ride the kit.
import { describe, expect, test } from "bun:test";
import {
  bootBuckle,
  mintKeyDir,
  stubEngine,
  stubProvider,
  type AccessRegistry,
} from "../kit.ts";
import { createLimiter } from "./buckle.admission.limits.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleProblem } from "../schemas/buckle.problem.zod.ts";

const DIR = mintKeyDir({
  "principal.rush@fleet.test.key": "bksk_rush",
  "principal.tier@fleet.test.key": "bksk_tier",
});

const chatOf = (base: string, key: string, model: string) =>
  fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
  });

async function bootedRush(access: AccessRegistry, model: string) {
  const engine = stubEngine();
  const provider = stubProvider([{ id: model }]);
  const world = await bootBuckle({
    label: "b1",
    dir: DIR,
    access,
    providers: { openrouter: `http://127.0.0.1:${provider.port}` },
    hubs: {},
    engineUrl: `http://127.0.0.1:${engine.port}`,
  });
  return {
    world,
    base: world.base,
    stop: () => {
      world.stop();
      engine.stop();
      provider.stop();
    },
  };
}

describe("the rate limiter (window math)", () => {
  test("admits under the cap, denies past it, reports Retry-After", () => {
    const limiter = createLimiter();
    expect(limiter.admit("p", 2).allowed).toBe(true);
    expect(limiter.admit("p", 2).allowed).toBe(true);
    const denied = limiter.admit("p", 2);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed)
      expect(denied.retryAfterS).toBeGreaterThanOrEqual(1);
    // other principals ride their OWN window
    expect(limiter.admit("q", 2).allowed).toBe(true);
  });

  test("the window frees as timestamps age out (fake clock)", () => {
    let now = 1_000_000;
    const limiter = createLimiter(() => now);
    expect(limiter.admit("p", 1).allowed).toBe(true);
    expect(limiter.admit("p", 1).allowed).toBe(false);
    now += 61_000; // past 60s: the first hit aged out
    expect(limiter.admit("p", 1).allowed).toBe(true);
  });

  test("no cap configured (0/undefined) always admits", () => {
    const limiter = createLimiter();
    for (let i = 0; i < 20; i++) expect(limiter.admit("p", 0).allowed).toBe(true);
  });
});

describe("the route enforces (429 + Retry-After)", () => {
  test("max_rpm 2 on the grant → third chat is 429 problem+json", async () => {
    const access: AccessRegistry = BuckleAccessRegistry.parse({
      principals: [{ id: "rush@fleet.test", kind: "agent", groups: [] }],
      grants: [
        {
          principal: "rush@fleet.test",
          scopes: ["models.list", "models.use"],
          limits: { max_rpm: 2 },
        },
      ],
      tiers: [],
    });
    const { base, stop } = await bootedRush(access, "openai/rush");
    try {
      expect((await chatOf(base, "bksk_rush", "openai/rush")).status).toBe(200);
      expect((await chatOf(base, "bksk_rush", "openai/rush")).status).toBe(200);
      const r = await chatOf(base, "bksk_rush", "openai/rush");
      expect(r.status).toBe(429);
      expect(r.headers.get("content-type")).toContain("application/problem+json");
      const retry = r.headers.get("retry-after");
      expect(retry).not.toBeNull();
      expect(Number(retry)).toBeGreaterThanOrEqual(1);
      const problem = BuckleProblem.parse(await r.json());
      expect(problem.kind).toBe("rate-limited");
      // /v1/models is NOT chat traffic: catalog stays open under the cap
      const models = await fetch(`${base}/v1/models`, {
        headers: { authorization: "Bearer bksk_rush" },
      });
      expect(models.status).toBe(200);
    } finally {
      stop();
    }
  });

  test("tier fallback: no grant limits → the principal's KIND tier caps", async () => {
    const access: AccessRegistry = BuckleAccessRegistry.parse({
      principals: [{ id: "tier@fleet.test", kind: "agent", groups: [] }],
      grants: [{ principal: "tier@fleet.test", scopes: ["models.list", "models.use"] }],
      tiers: [{ label: "agents", kind: "agent", max_rpm: 1 }],
    });
    const { base, stop } = await bootedRush(access, "openai/tier");
    try {
      expect((await chatOf(base, "bksk_tier", "openai/tier")).status).toBe(200);
      expect((await chatOf(base, "bksk_tier", "openai/tier")).status).toBe(429);
    } finally {
      stop();
    }
  });
});
