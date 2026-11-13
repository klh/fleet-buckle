// buckle.server.hop.test.ts — COMMIT 6 (test-first): the federation
// HOP. A chat for a peer-origin model rides to that peer verbatim:
// peer token, continued trace, hop-path loop guard, served-by chain.
// The peer re-checks models.use against ITS registry (per-hop grants).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { bootServer } from "./buckle.server.main.ts";
import { loadSettings } from "./buckle.server.settings.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleProblem } from "../schemas/buckle.problem.zod.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function keyDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "buckle-keys-"));
  const mint = (name: string, value: string) => {
    const p = join(dir, name);
    writeFileSync(p, value + "\n");
    chmodSync(p, 0o600);
  };
  mint("principal.bob@fleet.key", "bksk_bob");
  mint("principal.alice@fleet.key", "bksk_alice");
  mint("principal.federation@fleet.key", "bksk_federation");
  mint("peer-b3.token", "bksk_federation");
  return dir;
}

function stubProvider(rows: { id: string }[]): { port: number; stop: () => void } {
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
function stubEngine(): {
  port: number;
  stop: () => void;
  seen: { auth: string | null; traceparent: string | null; hopPath: string | null; raw: string }[];
} {
  const seen: { auth: string | null; traceparent: string | null; hopPath: string | null; raw: string }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      seen.push({
        auth: req.headers.get("authorization"),
        traceparent: req.headers.get("traceparent"),
        hopPath: req.headers.get("x-fleet-buckle-hop-path"),
        raw: await req.text(),
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

/** transparent recorder: forwards every request to the peer
 *  VERBATIM and records what rode in (token, hop-path, body bytes). */
function recorder(target: number): {
  port: number;
  stop: () => void;
  seen: { auth: string | null; traceparent: string | null; hopPath: string | null; raw: string }[];
} {
  const seen: { auth: string | null; traceparent: string | null; hopPath: string | null; raw: string }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const raw = await req.text();
      seen.push({
        auth: req.headers.get("authorization"),
        traceparent: req.headers.get("traceparent"),
        hopPath: req.headers.get("x-fleet-buckle-hop-path"),
        raw,
      });
      return fetch(`http://127.0.0.1:${target}${new URL(req.url).pathname}`, {
        method: req.method,
        headers: {
          "content-type": "application/json",
          ...(req.headers.get("traceparent") === null ? {} : { traceparent: req.headers.get("traceparent")! }),
          ...(req.headers.get("authorization") === null ? {} : { authorization: req.headers.get("authorization")! }),
          ...(req.headers.get("x-fleet-buckle-hop-path") === null ? {} : { "x-fleet-buckle-hop-path": req.headers.get("x-fleet-buckle-hop-path")! }),
        },
        body: raw,
      });
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true), seen };
}

/** the hop world: head b1 (bob peers b3, alice own-only) + peer b3
 *  behind a transparent recorder, over its own provider + engine stubs. */
async function bootHopWorld(dir: string, peerGrants: {
  scopes: string[];
  limits?: { max_rpm: number };
}) {
  const engine = stubEngine();
  const peerProvider = stubProvider([{ id: "glm-5.3" }]);
  const base = await loadSettings({
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, "deploy/settings/b1.settings.json5"),
  });
  const peer = bootServer({
    settings: {
      ...base,
      hub: { ...base.hub, label: "b3" },
      keys: { ...(base.keys ?? {}), principals_dir: dir },
      engine: { url: `http://127.0.0.1:${engine.port}` },
      access: BuckleAccessRegistry.parse({
        principals: [{ id: "federation@fleet", kind: "service", groups: [] }],
        grants: [{
          principal: "federation@fleet",
          scopes: peerGrants.scopes,
          ...(peerGrants.limits === undefined ? {} : { limits: peerGrants.limits }),
        }],
        tiers: [],
      }),
      hubs: {},
      providers: { zai: { url: `http://127.0.0.1:${peerProvider.port}` } },
    },
    port: 0,
  });
  const rec = recorder(peer.port ?? 0);
  const head = bootServer({
    settings: {
      ...base,
      hub: { ...base.hub, label: "b1" },
      keys: { ...(base.keys ?? {}), principals_dir: dir },
      access: BuckleAccessRegistry.parse({
        principals: [
          { id: "bob@fleet", kind: "human", groups: [] },
          { id: "alice@fleet", kind: "human", groups: [] },
        ],
        grants: [
          { principal: "bob@fleet", scopes: ["models.list", "models.use"], peers: ["b3"] },
          { principal: "alice@fleet", scopes: ["models.list", "models.use"], peers: [] },
        ],
        tiers: [],
      }),
      hubs: { b3: { url: `http://127.0.0.1:${rec.port}`, token_file: join(dir, "peer-b3.token") } },
      providers: { openrouter: { url: "http://127.0.0.1:1" } }, // dead own provider: own rows absent, peer rows only
    },
    port: 0,
  });
  return {
    head: `http://127.0.0.1:${head.port}`,
    engine,
    seen: rec.seen,
    stop: () => {
      peerProvider.stop();
      peer.stop(true);
      head.stop(true);
      rec.stop();
    },
  };
}

const HOP_BODY = JSON.stringify({
  model: "glm-5.3",
  messages: [{ role: "user", content: "hop me" }],
});

const postChat = (base: string, key: string, extra: Record<string, string> = {}) =>
  fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...extra },
    body: HOP_BODY,
  });

describe("COMMIT 6 — the federated HOP (per-hop grants)", () => {
  test("bob's zai chat HOPS to b3 verbatim; chain + trace + token + path all ride", async () => {
    const dir = keyDir();
    const world = await bootHopWorld(dir, { scopes: ["models.list", "models.use"] });
    try {
      const inbound = "00-abcdef1234567890abcdef1234567890-1111111111111111-01";
      const r = await postChat(world.head, "bksk_bob", { traceparent: inbound });
      expect(r.status).toBe(200);
      expect(r.headers.get("x-fleet-buckle-served-by")).toBe("b1,b3");
      const body = (await r.json()) as { id: string };
      expect(body.id).toBe("engine-echo"); // peer's engine, not ours
      // the catalog pull rode the recorder too; the CHAT is the one
      // carrying our body bytes
      const saw = world.seen.find((s) => s.raw === HOP_BODY);
      expect(saw?.auth).toBe("Bearer bksk_federation"); // peer token rode the hop
      const tp = saw?.traceparent ?? "";
      expect(tp.split("-")[1]).toBe("abcdef1234567890abcdef1234567890"); // same trace id
      expect(tp.split("-")[2]).not.toBe("1111111111111111"); // new span id
      expect(saw?.hopPath).toBe("b1"); // the head's label rode the path
      expect(saw?.raw).toBe(HOP_BODY); // body bytes untouched
    } finally {
      world.stop();
    }
  });

  test("a peer model OUTSIDE the grant's peers is indistinguishable from unknown (404)", async () => {
    const dir = keyDir();
    const world = await bootHopWorld(dir, { scopes: ["models.list", "models.use"] });
    try {
      // alice: peers [] — glm-5.3 is real on b3 but NOT in her view
      const r = await postChat(world.head, "bksk_alice");
      expect(r.status).toBe(404);
      expect(r.headers.get("content-type")).toContain("application/problem+json");
      const problem = BuckleProblem.parse(await r.json());
      expect(problem.kind).toBe("not-found");
      expect(world.engine.seen.length).toBe(0); // never rode any hop
    } finally {
      world.stop();
    }
  });

  test("the loop guard: a hub already on the hop path refuses re-entry", async () => {
    const dir = keyDir();
    const world = await bootHopWorld(dir, { scopes: ["models.list", "models.use"] });
    try {
      const r = await postChat(world.head, "bksk_bob", { "x-fleet-buckle-hop-path": "b1" });
      expect(r.status).toBe(503);
      const problem = BuckleProblem.parse(await r.json());
      expect(problem.kind).toBe("unavailable");
      expect(problem.title).toContain("loop");
      expect(world.seen.length).toBe(0);
    } finally {
      world.stop();
    }
  });

  test("a 429 at the hop RELAYS to the client with Retry-After", async () => {
    const dir = keyDir();
    const world = await bootHopWorld(dir, {
      scopes: ["models.list", "models.use"],
      limits: { max_rpm: 1 },
    });
    try {
      const first = await postChat(world.head, "bksk_bob");
      expect(first.status).toBe(200);
      const second = await postChat(world.head, "bksk_bob");
      expect(second.status).toBe(429);
      expect(second.headers.get("content-type")).toContain("application/problem+json");
      expect(second.headers.get("retry-after")).toBeTruthy();
      const problem = BuckleProblem.parse(await second.json());
      expect(problem.kind).toBe("rate-limited");
      expect(problem.title).toContain("b3"); // the peer is named
    } finally {
      world.stop();
    }
  });

  test("peer refusal (federation lacks models.use THERE) surfaces 503 naming the peer", async () => {
    const dir = keyDir();
    // models.list only: the catalog pull succeeds, the HOP is refused
    const world = await bootHopWorld(dir, { scopes: ["models.list"] });
    try {
      const r = await postChat(world.head, "bksk_bob");
      expect(r.status).toBe(503);
      const problem = BuckleProblem.parse(await r.json());
      expect(problem.kind).toBe("unavailable");
      expect(problem.title).toContain("b3");
      expect(world.engine.seen.length).toBe(0); // the peer never reached its engine
    } finally {
      world.stop();
    }
  });
});

