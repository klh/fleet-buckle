import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConfig, type Config } from "./entra-login.config.ts";
import { buildCliEnv } from "./entra-login.env.ts";
import { preflight } from "./entra-login.preflight.ts";
import { freshClaudeConfigDir } from "./entra-login.settings.ts";

const valid = {
  clientId: "b7e56a3c-9f4e-4d2a-8c1b-7f6a2d3e4f5c",
  tenantId: "c3d2a8e1-5b47-4c9f-9a2b-6d8e1f3a5c7d",
  scope: "api://gateway/access_as_user",
  gatewayUrl: "http://127.0.0.1:1",
  lane: "b3-pilot",
  mode: "url-pat",
  patFile: "/tmp/pat",
} as const;

describe("entra-login config", () => {
  test("parses a valid config and defaults claudeBin", () => {
    const r = parseConfig(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.claudeBin).toBe("claude");
  });
  test("rejects a bad mode with the offending path", () => {
    const r = parseConfig({ ...valid, mode: "pat-in-header" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fault.kind).toBe("config-parse");
      expect(r.fault.detail).toContain("mode");
    }
  });
  test("rejects a non-uuid clientId", () => {
    expect(parseConfig({ ...valid, clientId: "nope" }).ok).toBe(false);
  });
});

describe("entra-login cli env matrix", () => {
  const cfg = (mode: Config["mode"]): Config => {
    const r = parseConfig({ ...valid, mode });
    if (!r.ok) throw new Error(`fixture invalid: ${r.fault.detail}`);
    return r.value;
  };
  test("url-pat: PAT rides the URL, Entra rides AUTH_TOKEN", () => {
    const env = buildCliEnv(cfg("url-pat"), "PAT-X", "ENTRA-Y", "/tmp/cc");
    expect(env["ANTHROPIC_BASE_URL"]).toEndWith("/w/b3-pilot/PAT-X");
    expect(env["ANTHROPIC_AUTH_TOKEN"]).toBe("ENTRA-Y");
    expect(env["ANTHROPIC_CUSTOM_HEADERS"]).toBeUndefined();
    expect(env["CLAUDE_CONFIG_DIR"]).toBe("/tmp/cc");
  });
  test("bearer-pat: PAT rides AUTH_TOKEN, Entra rides CUSTOM_HEADERS", () => {
    const env = buildCliEnv(cfg("bearer-pat"), "PAT-X", "ENTRA-Y", "/tmp/cc");
    expect(env["ANTHROPIC_BASE_URL"]).toEndWith("/w/b3-pilot");
    expect(env["ANTHROPIC_AUTH_TOKEN"]).toBe("PAT-X");
    expect(JSON.parse(env["ANTHROPIC_CUSTOM_HEADERS"] ?? "{}").Authorization).toBe("Bearer ENTRA-Y");
  });
});

describe("entra-login settings", () => {
  test("fresh config dir is onboarding-complete", () => {
    const dir = freshClaudeConfigDir();
    const json = JSON.parse(readFileSync(join(dir, ".claude.json"), "utf8"));
    expect(json.hasCompletedOnboarding).toBe(true);
  });
});

describe("entra-login preflight", () => {
  const cfg = (mode: Config["mode"]): Config => {
    const r = parseConfig({ ...valid, mode });
    if (!r.ok) throw new Error(`fixture invalid: ${r.fault.detail}`);
    return r.value;
  };
  test("200 with a models array passes and counts rows", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json({ models: [{ id: "m1" }, { id: "m2" }] }),
    });
    const config = cfg("url-pat");
    const r = await preflight({ ...config, gatewayUrl: `http://127.0.0.1:${server.port}` }, "PAT", "ENTRA");
    server.stop(true);
    expect(r).toEqual({ ok: true, models: 2 });
  });
  test("401 fails with the status in the detail", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("denied", { status: 401 }) });
    const config = cfg("url-pat");
    const r = await preflight({ ...config, gatewayUrl: `http://127.0.0.1:${server.port}` }, "PAT", "ENTRA");
    server.stop(true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fault.detail).toContain("401");
  });
});
