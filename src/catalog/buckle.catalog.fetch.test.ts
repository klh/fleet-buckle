// buckle.catalog.fetch.test.ts — the OWN catalog is FETCHED from
// providers, never declared (law c): a stub provider serves fixture
// rows (bare ids AND a full mscopilot-shaped row); GET /v1/models
// maps them through the wire schema — origin names the provider, full
// metadata rides VERBATIM (captured, never fabricated). Worlds ride
// the kit; responses parse through BuckleModelsResponse.
import { describe, expect, test } from "bun:test";
import {
  bootBuckle,
  mintKeyDir,
  stubProvider,
  type AccessRegistry,
  type WorldProvider,
} from "../kit.ts";
import { CacheEntrySchema } from "./buckle.catalog.fetch.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleModelsResponse } from "../schemas/buckle.model.wire.zod.ts";

const DIR = mintKeyDir({ "principal.wire@fleet.test.key": "bksk_wire_test" });
const AUTH = { authorization: "Bearer bksk_wire_test" };
const ACCESS: AccessRegistry = BuckleAccessRegistry.parse({
  principals: [{ id: "wire@fleet.test", kind: "service", groups: [] }],
  grants: [{ principal: "wire@fleet.test", scopes: ["models.list", "models.use"] }],
  tiers: [],
});

/** a full mscopilot-shaped provider row (captured shape) */
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

async function bootedWithProviders(
  providers: Record<string, WorldProvider>,
) {
  const world = await bootBuckle({
    label: "b1",
    dir: DIR,
    access: ACCESS,
    providers,
    hubs: {},
  });
  return { world, base: world.base };
}

describe("the catalog cache entry (the fetch cache's contract)", () => {
  test("rows + stamped at, strict", () => {
    const entry = CacheEntrySchema.safeParse({
      at: 1,
      rows: [{ id: "zai/glm-5.3", origin: { kind: "provider", label: "zai" } }],
    });
    expect(entry.success).toBe(true);
    // the ROW is the contract: a model without its origin never caches
    expect(
      CacheEntrySchema.safeParse({ at: 1, rows: [{ id: "zai/glm-5.3" }] })
        .success,
    ).toBe(false);
  });
});

describe("/v1/models (fetch, never declare)", () => {
  test("bare provider rows pass through with origin", async () => {
    const provider = stubProvider([
      { id: "openrouter/qwen3-coder" },
      { id: "openrouter/qwen3-235b" },
    ]);
    const { world, base } = await bootedWithProviders({
      openrouter: `http://127.0.0.1:${provider.port}`,
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
      world.stop();
    }
  });

  test("FULL provider metadata rides verbatim — captured, never fabricated", async () => {
    const provider = stubProvider([FULL_ROW]);
    const { world, base } = await bootedWithProviders({
      mscopilot: `http://127.0.0.1:${provider.port}`,
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
      world.stop();
    }
  });

  test("a dead provider fails CLOSED for its rows only (others still serve)", async () => {
    const alive = stubProvider([{ id: "zai/glm-5.3" }]);
    // port 1 on 127.0.0.1: nothing listens — fetch fails fast
    const { world, base } = await bootedWithProviders({
      zai: `http://127.0.0.1:${alive.port}`,
      // unknown label: the registry law needs the dialect explicit
      dead: { url: "http://127.0.0.1:1", dialect: "openai" },
    });
    try {
      const r = await fetch(`${base}/v1/models`, { headers: AUTH });
      expect(r.status).toBe(200);
      const body = BuckleModelsResponse.parse(await r.json());
      expect(body.models.map((m) => m.id)).toEqual(["zai/glm-5.3"]);
      expect(body.models.every((m) => m.origin.kind === "provider")).toBe(true);
    } finally {
      alive.stop();
      world.stop();
    }
  });
});
