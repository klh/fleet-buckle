// buckle.server.limits.test.ts — COMMIT 5 STEP 2 (test-first): per-
// principal RPM enforcement. Grants (or the principal's tier) cap
// requests on a rolling 60s window; past the cap → 429 problem+json
// with a Retry-After seconds header. Enforcement lives at the chat
// route (models.use), AFTER auth — never before.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { bootServer } from "./buckle.server.main.ts";
import { loadSettings } from "./buckle.server.settings.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { createLimiter } from "./buckle.server.limits.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("COMMIT 5 STEP 2 — the rate limiter (window math)", () => {
  test("admits under the cap, denies past it, reports Retry-After", () => {
    const limiter = createLimiter();
    expect(limiter.admit("p", 2).allowed).toBe(true);
    expect(limiter.admit("p", 2).allowed).toBe(true);
    const denied = limiter.admit("p", 2);
    expect(diedNied(denied)).toBe(false);
    if (!denied.allowed)
      expect(denied.retryAfterS).toBeGreaterThanOrEqual(1);
    // other principals ride their OWN window
    expect(limiter.admit("q", 2).allowed).toBe(true);
  });
  function diedNied(
    r: { allowed: boolean; retryAfterS?: number },
  ): boolean {
    return r.allowed;
  }

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

describe("COMMIT 5 STEP 2 — the route enforces (429 + Retry-After)", () => {
  test("max_rpm 2 on the grant → third chat is 429 problem+json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "buckle-keys-"));
    const keyPath = join(dir, "principal.rush@fleet.test.key");
    writeFileSync(keyPath, "bksk_rush\n");
    chmodSync(keyPath, 0o600);
    const engine = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          id: "x",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
    });
    const provider = Bun.serve({
      port: 0,
      fetch: (req) =>
        new URL(req.url).pathname === "/v1/models"
          ? Response.json({ data: [{ id: "openai/rush" }] })
          : new Response("nf", { status: 404 }),
    });
    const base = await loadSettings({
      defaults: join(ROOT, "deploy/settings/default.settings.json5"),
      settings: join(ROOT, "deploy/settings/b1.settings.json5"),
    });
    const server = bootServer({
      settings: {
        ...base,
        keys: { ...(base.keys ?? {}), principals_dir: dir },
        access: BuckleAccessRegistry.parse({
          principals: [{ id: "rush@fleet.test", kind: "agent", groups: [] }],
          grants: [
            {
              principal: "rush@fleet.test",
              scopes: ["models.list", "models.use"],
              limits: { max_rpm: 2 },
            },
          ],
          tiers: [],
        }),
        hubs: {},
        engine: { url: `http://127.0.0.1:${engine.port}` },
        providers: { openrouter: { url: `http://127.0.0.1:${provider.port}` } },
      },
      port: 0,
    });
    try {
      const H = { authorization: "Bearer bksk_rush", "content-type": "application/json" };
      const chat = () =>
        fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
          method: "POST",
          headers: H,
          body: JSON.stringify({ model: "openai/rush", messages: [{ role: "user", content: "hi" }] }),
        });
      expect((await chat()).status).toBe(200);
      expect((await chat()).status).toBe(200);
      const r = await chat();
      expect(r.status).toBe(429);
      expect(r.headers.get("content-type")).toContain("application/problem+json");
      const retry = r.headers.get("retry-after");
      expect(retry).not.toBeNull();
      expect(Number(retry)).toBeGreaterThanOrEqual(1);
      expect(((await r.json()) as { kind: string }).kind).toBe("rate-limited");
      // /v1/models is NOT chat traffic: catalog stays open under the cap
      const models = await fetch(`http://127.0.0.1:${server.port}/v1/models`, { headers: H });
      expect(models.status).toBe(200);
    } finally {
      engine.stop(true);
      provider.stop(true);
      server.stop(true);
    }
  });

  test("tier fallback: no grant limits → the principal's KIND tier caps", async () => {
    const dir = mkdtempSync(join(tmpdir(), "buckle-keys-"));
    writeFileSync(join(dir, "principal.tier@fleet.test.key"), "bksk_tier\n");
    const engine = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          id: "x", object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
    });
    const provider = Bun.serve({
      port: 0,
      fetch: (req) =>
        new URL(req.url).pathname === "/v1/models"
          ? Response.json({ data: [{ id: "openai/tier" }] })
          : new Response("nf", { status: 404 }),
    });
    const base = await loadSettings({
      defaults: join(ROOT, "deploy/settings/default.settings.json5"),
      settings: join(ROOT, "deploy/settings/b1.settings.json5"),
    });
    const server = bootServer({
      settings: {
        ...base,
        keys: { ...(base.keys ?? {}), principals_dir: dir },
        access: BuckleAccessRegistry.parse({
          principals: [{ id: "tier@fleet.test", kind: "agent", groups: [] }],
          grants: [{ principal: "tier@fleet.test", scopes: ["models.list", "models.use"] }],
          tiers: [{ label: "agents", kind: "agent", max_rpm: 1 }],
        }),
        hubs: {},
        engine: { url: `http://127.0.0.1:${engine.port}` },
        providers: { openrouter: { url: `http://127.0.0.1:${provider.port}` } },
      },
      port: 0,
    });
    try {
      const chat = () =>
        fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
          method: "POST",
          headers: { authorization: "Bearer bksk_tier", "content-type": "application/json" },
          body: JSON.stringify({ model: "openai/tier", messages: [{ role: "user", content: "hi" }] }),
        });
      expect((await chat()).status).toBe(200);
      expect((await chat()).status).toBe(429);
    } finally {
      engine.stop(true);
      provider.stop(true);
      server.stop(true);
    }
  });
});
