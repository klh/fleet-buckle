// buckle.proxy.mcp.test.ts — B10: MCP rides Buckle's authenticated ingress to
// LiteLLM's native /mcp and on to the Worker-owned face. HERMETIC: the engine
// stub models LiteLLM's tool grants; the worker stub models the W18 face
// (idempotent command). Buckle owns no tool registry.
import { describe, expect, test } from "bun:test";
import { bootBuckle, mintKeyDir, stubProvider, type AccessRegistry } from "../kit.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";

const DIR = mintKeyDir({
  "principal.alice@fleet.key": "bksk_alice_mcp",
  "principal.bob@fleet.key": "bksk_bob_mcp",
});
const ACCESS: AccessRegistry = BuckleAccessRegistry.parse({
  principals: [
    { id: "alice@fleet", kind: "human", groups: [] },
    { id: "bob@fleet", kind: "human", groups: [] },
  ],
  grants: [
    { principal: "alice@fleet", scopes: ["models.list", "engine.passthrough"] },
    { principal: "bob@fleet", scopes: ["models.list"] },
  ],
  tiers: [],
});

function rig() {
  const executed = new Map<string, unknown>();
  let executions = 0;
  const worker = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const key = req.headers.get("idempotency-key") ?? "";
      const hit = executed.get(key);
      if (hit !== undefined) return Response.json({ ...(hit as object), replayed: true });
      executions++;
      const out = { receipt: `r-${key}`, executor: "worker" };
      executed.set(key, out);
      return Response.json({ ...out, replayed: false });
    },
  });
  // LiteLLM stand-in: native grant check (only worker_submit_command granted)
  const engine = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const rpc = (await req.json()) as { params: { name: string; arguments: { key: string } } };
      if (rpc.params.name !== "worker_submit_command")
        return Response.json({ error: "tool not permitted for key" }, { status: 403 });
      return fetch(`http://127.0.0.1:${worker.port}/mcp`, {
        method: "POST",
        headers: { "idempotency-key": rpc.params.arguments.key },
      });
    },
  });
  return {
    engine,
    executions: () => executions,
    stop: () => {
      engine.stop(true);
      worker.stop(true);
    },
  };
}

const call = (base: string, key: string, name: string, idem = "k1") =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: { key: idem } },
    }),
  });

describe("MCP through Buckle/LiteLLM to the Worker face", () => {
  test("unauthorized: no engine.passthrough → 403; ungranted tool → rejected", async () => {
    const r = rig();
    const provider = stubProvider([{ id: "m" }]);
    const world = await bootBuckle({
      label: "b10",
      dir: DIR,
      access: ACCESS,
      providers: { openrouter: `http://127.0.0.1:${provider.port}` },
      engineUrl: `http://127.0.0.1:${r.engine.port}`,
    });
    try {
      expect((await call(world.base, "bksk_bob_mcp", "worker_submit_command")).status).toBe(403);
      expect((await call(world.base, "bksk_alice_mcp", "worker_delete_all")).status).toBe(403);
      expect(r.executions()).toBe(0);
    } finally {
      world.stop();
      provider.stop();
      r.stop();
    }
  });

  test("replay-safe command executes once; replay returns the same receipt", async () => {
    const r = rig();
    const provider = stubProvider([{ id: "m" }]);
    const world = await bootBuckle({
      label: "b10",
      dir: DIR,
      access: ACCESS,
      providers: { openrouter: `http://127.0.0.1:${provider.port}` },
      engineUrl: `http://127.0.0.1:${r.engine.port}`,
    });
    try {
      const a = (await (await call(world.base, "bksk_alice_mcp", "worker_submit_command")).json()) as Record<string, unknown>;
      const b = (await (await call(world.base, "bksk_alice_mcp", "worker_submit_command")).json()) as Record<string, unknown>;
      expect(a.replayed).toBe(false);
      expect(b.replayed).toBe(true);
      expect(b.receipt).toBe(a.receipt);
      expect(r.executions()).toBe(1);
    } finally {
      world.stop();
      provider.stop();
      r.stop();
    }
  });
});
