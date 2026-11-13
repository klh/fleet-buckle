// buckle.server.models.test.ts — STEP 2 (test-first): the catalog is
// FETCHED from providers, never declared (law c): a stub provider
// serves fixture rows (bare ids AND a full mscopilot-shaped row);
// GET /v1/models maps them through the wire schema — origin names the
// provider, full metadata rides VERBATIM (captured, never fabricated).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootServer } from "./buckle.server.main.ts";
import { loadSettings } from "./buckle.server.settings.ts";
import { BuckleModelsResponse } from "../schemas/buckle.model.wire.zod.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
const KEYS_DIR = mkdtempSync(join(tmpdir(), "buckle-keys-"));
const wireKey = (name: string): string => {
  const p = join(KEYS_DIR, name);
  writeFileSync(p, "bksk_wire_test\n");
  chmodSync(p, 0o600);
  return p;
};
wireKey("principal.wire@fleet.test.key");
const AUTH = { authorization: "Bearer bksk_wire_test" };
const ACCESS = BuckleAccessRegistry.parse({
  principals: [{ id: "wire@fleet.test", kind: "service", groups: [] }],
  grants: [
    { principal: "wire@fleet.test", scopes: ["models.list", "models.use"] },
  ],
  tiers: [],
});

const FULL_ROW = {
  id: "mscopilot/gpt-6-astra",
  name: "GPT-6 Astra",
  vendor: "openai",
  version: "6.0",
  preview: false,
  policy: { state: "enabled" },
  capabilities: {
    limits: { max_context_window_tokens: 200000, max_output_tokens: 100000 },
    supports: { tool_calls: true, streaming: true },
  },
};

function stubProvider(rows: unknown[]): { port: number; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      if (new URL(req.url).pathname === "/v1/models")
        return Response.json({ data: rows });
      return new Response("not found", { status: 404 });
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true) };
}

async function bootedWithProviders(providers: Record<string, unknown>) {
  const base = await loadSettings({
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, "deploy/settings/b1.settings.json5"),
  });
  const settings = {
    ...base,
    keys: { ...(base.keys ?? {}), principals_dir: KEYS_DIR },
    access: ACCESS,
    providers: providers as never,
  };
  const server = bootServer({ settings, port: 0 });
  return { server, base: `http://127.0.0.1:${server.port}` };
}

describe("STEP 2 — /v1/models (fetch, never declare)", () => {
  test("bare provider rows pass through with origin", async () => {
    const provider = stubProvider([
      { id: "openrouter/qwen3-coder" },
      { id: "openrouter/qwen3-235b" },
    ]);
    const { server, base } = await bootedWithProviders({
      openrouter: { url: `http://127.0.0.1:${provider.port}` },
    });
    try {
      const r = await fetch(`${base}/v1/models`, { headers: AUTH });
      expect(r.status).toBe(200);
      const body = BuckleModelsResponse.parse(await r.json());
      expect(body.hub).toBe("b1");
      expect(body.models.map((m) => m.id).sort()).toEqual([
        "openrouter/qwen3-235b",
        "openrouter/qwen3-coder",
      ]);
      for (const m of body.models)
        expect(m.origin).toEqual({
          kind: "provider",
          label: "openrouter",
          url: `http://127.0.0.1:${provider.port}`,
        });
    } finally {
      provider.stop();
      server.stop(true);
    }
  });

  test("FULL provider metadata rides verbatim — captured, never fabricated", async () => {
    const provider = stubProvider([FULL_ROW]);
    const { server, base } = await bootedWithProviders({
      mscopilot: { url: `http://127.0.0.1:${provider.port}` },
    });
    try {
      const r = await fetch(`${base}/v1/models`, { headers: AUTH });
      const body = BuckleModelsResponse.parse(await r.json());
      expect(body.models.length).toBe(1);
      const m = body.models[0]!;
      expect(m.id).toBe("mscopilot/gpt-6-astra");
      expect(m.origin).toEqual({
        kind: "provider",
        label: "mscopilot",
        url: `http://127.0.0.1:${provider.port}`,
      });
      // verbatim: every field of the provider's own row survives
      expect(m.meta).toEqual(FULL_ROW);
    } finally {
      provider.stop();
      server.stop(true);
    }
  });

  test("a dead provider fails CLOSED for its rows only (others still serve)", async () => {
    const alive = stubProvider([{ id: "zai/glm-5.3" }]);
    // port 1 on 127.0.0.1: nothing listens — fetch fails fast
    const { server, base } = await bootedWithProviders({
      zai: { url: `http://127.0.0.1:${alive.port}` },
      dead: { url: "http://127.0.0.1:1" },
    });
    try {
      const r = await fetch(`${base}/v1/models`, { headers: AUTH });
      expect(r.status).toBe(200);
      const body = BuckleModelsResponse.parse(await r.json());
      expect(body.models.map((m) => m.id)).toEqual(["zai/glm-5.3"]);
      expect(body.models.every((m) => m.origin.kind === "provider")).toBe(true);
    } finally {
      alive.stop();
      server.stop(true);
    }
  });
});
