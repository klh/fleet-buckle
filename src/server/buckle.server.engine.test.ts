// buckle.server.engine.test.ts — the ENGINE GATE: when keys.engine is
// configured and readable, the engine leg carries Bearer (litellm
// master_key enforces it); with no key configured the engine leg is
// anonymous (stub engines are open). Worlds ride the kit (never
// hand-rolled) and assertions read what ARRIVED at the engine stub.
import { describe, expect, test } from "bun:test";
import {
  bootBuckle,
  mintKeyDir,
  stubEngine,
  stubProvider,
  type AccessRegistry,
} from "./buckle.server.kit.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";

const DIR = mintKeyDir({
  "principal.gate@fleet.test.key": "bksk_gate_test",
  // the engine master key the gated world reads (keys.engine)
  "engine.master.key": "bksk_engine_master_test",
});
const AUTH = { authorization: "Bearer bksk_gate_test" };
const ACCESS: AccessRegistry = BuckleAccessRegistry.parse({
  principals: [{ id: "gate@fleet.test", kind: "service", groups: [] }],
  grants: [{ principal: "gate@fleet.test", scopes: ["models.list", "models.use"] }],
  tiers: [],
});

async function chat(base: string): Promise<Response> {
  return fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...AUTH },
    body: JSON.stringify({
      model: "openrouter/qwen3-coder",
      messages: [{ role: "user", content: "hi" }],
    }),
  });
}

describe("the engine gate (keys.engine)", () => {
  test("keys.engine configured → the engine leg carries Bearer <master key>", async () => {
    const provider = stubProvider([{ id: "openrouter/qwen3-coder" }]);
    const engine = stubEngine();
    const world = await bootBuckle({
      label: "b1",
      dir: DIR,
      access: ACCESS,
      providers: { openrouter: `http://127.0.0.1:${provider.port}` },
      hubs: {},
      engineUrl: `http://127.0.0.1:${engine.port}`,
      engineKeyFile: `${DIR}/engine.master.key`,
    });
    const r = await chat(world.base);
    expect(r.status).toBe(200);
    expect(engine.seen.at(-1)?.auth).toBe("Bearer bksk_engine_master_test");
    world.stop();
    engine.stop();
    provider.stop();
  });

  test("no keys.engine → the engine leg stays anonymous (open engines)", async () => {
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
    const r = await chat(world.base);
    expect(r.status).toBe(200);
    expect(engine.seen.at(-1)?.auth).toBeNull();
    world.stop();
    engine.stop();
    provider.stop();
  });
});
