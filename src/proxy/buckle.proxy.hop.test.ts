// buckle.proxy.hop.test.ts — the federation HOP: a chat for a
// peer-origin model rides to that peer verbatim (peer token, continued
// trace, hop-path loop guard, served-by chain, chain deadline). The
// peer re-checks models.use against ITS registry (per-hop grants).
// Worlds ride the kit; the peer sits behind the kit's recorder.
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  bootBuckle,
  mintKeyDir,
  recorder,
  stubEngine,
  stubProvider,
  type AccessRegistry,
} from "../kit.ts";
import { mergeSettings } from "../schemas/buckle.settings.zod.ts";

/** the hop bound in tests = the settings default (120s) */
const HOP_TIMEOUT_MS = mergeSettings({ hub: { label: "t" } }, {}).timeouts.hop_ms;
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleProblem } from "../schemas/buckle.problem.zod.ts";

function hopKeyDir(): string {
  return mintKeyDir({
    "principal.bob@fleet.key": "bksk_bob",
    "principal.alice@fleet.key": "bksk_alice",
    "principal.federation@fleet.key": "bksk_federation",
    "peer-b3.token": "bksk_federation",
  });
}

/** the engine's echo RESPONSE — parsed, never hand-cast (zod law) */
const EchoBody = z.object({ id: z.string() }).passthrough();

const HEAD_ACCESS: AccessRegistry = BuckleAccessRegistry.parse({
  principals: [
    { id: "bob@fleet", kind: "human", groups: [] },
    { id: "alice@fleet", kind: "human", groups: [] },
  ],
  grants: [
    { principal: "bob@fleet", scopes: ["models.list", "models.use"], peers: ["b3"] },
    { principal: "alice@fleet", scopes: ["models.list", "models.use"], peers: [] },
  ],
  tiers: [],
});

/** the hop world: head b1 (bob peers b3, alice own-only) + peer b3
 *  behind a transparent recorder, over its own provider + engine stubs. */
async function bootHopWorld(
  dir: string,
  peerGrants: {
    scopes: string[];
    limits?: { max_rpm: number };
  },
) {
  const engine = stubEngine();
  const peerProvider = stubProvider([{ id: "glm-5.3" }]);
  const peerAccess: AccessRegistry = BuckleAccessRegistry.parse({
    principals: [{ id: "federation@fleet", kind: "service", groups: [] }],
    grants: [
      {
        principal: "federation@fleet",
        scopes: peerGrants.scopes,
        ...(peerGrants.limits === undefined ? {} : { limits: peerGrants.limits }),
      },
    ],
    tiers: [],
  });
  const peer = await bootBuckle({
    label: "b3",
    dir,
    access: peerAccess,
    providers: { zai: `http://127.0.0.1:${peerProvider.port}` },
    hubs: {},
    engineUrl: `http://127.0.0.1:${engine.port}`,
  });
  const rec = recorder(peer.port);
  const head = await bootBuckle({
    label: "b1",
    dir,
    access: HEAD_ACCESS,
    providers: { openrouter: "http://127.0.0.1:1" }, // dead own provider: own rows absent, peer rows only
    hubs: { b3: `http://127.0.0.1:${rec.port}` },
  });
  return {
    head: head.base,
    engine,
    seen: rec.seen,
    stop: () => {
      peerProvider.stop();
      peer.stop();
      head.stop();
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

describe("the federated HOP (per-hop grants)", () => {
  test("bob's zai chat HOPS to b3 verbatim; chain + trace + token + path all ride", async () => {
    const dir = hopKeyDir();
    const world = await bootHopWorld(dir, { scopes: ["models.list", "models.use"] });
    try {
      const inbound = "00-abcdef1234567890abcdef1234567890-1111111111111111-01";
      const r = await postChat(world.head, "bksk_bob", { traceparent: inbound });
      expect(r.status).toBe(200);
      expect(r.headers.get("x-fleet-buckle-served-by")).toBe("b1,b3");
      const body = EchoBody.parse(await r.json());
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
    const dir = hopKeyDir();
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
    const dir = hopKeyDir();
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
    const dir = hopKeyDir();
    // max_rpm 1 at the peer: first rides, second relays the 429
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
    const dir = hopKeyDir();
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

  test("the chain budget: an origin STAMPS it, a relay carries it VERBATIM", async () => {
    const dir = hopKeyDir();
    const world = await bootHopWorld(dir, { scopes: ["models.list", "models.use"] });
    try {
      // origin (no inbound deadline): b1 stamps now + its hop budget
      const before = Date.now();
      expect((await postChat(world.head, "bksk_bob")).status).toBe(200);
      const chat = world.seen.find((s) => s.raw === HOP_BODY)!;
      const stamped = Number(chat.deadline);
      expect(stamped).toBeGreaterThanOrEqual(before + 60_000);
      expect(stamped).toBeLessThanOrEqual(Date.now() + HOP_TIMEOUT_MS);

      // relay (inbound deadline present): carried VERBATIM, never rewritten
      const relayDeadline = String(Date.now() + 5_000);
      expect(
        (
          await postChat(world.head, "bksk_bob", {
            "x-fleet-buckle-deadline-ms": relayDeadline,
          })
        ).status,
      ).toBe(200);
      const relayed = world.seen.filter((s) => s.raw === HOP_BODY).at(-1)!;
      expect(relayed.deadline).toBe(relayDeadline);
    } finally {
      world.stop();
    }
  });

  test("an EXHAUSTED deadline refuses before ANY peer traffic", async () => {
    const dir = hopKeyDir();
    const world = await bootHopWorld(dir, { scopes: ["models.list", "models.use"] });
    try {
      const r = await postChat(world.head, "bksk_bob", {
        "x-fleet-buckle-deadline-ms": String(Date.now() - 1_000),
      });
      expect(r.status).toBe(503);
      const problem = BuckleProblem.parse(await r.json());
      expect(problem.kind).toBe("unavailable");
      expect(problem.title).toContain("deadline");
      expect(world.seen.length).toBe(0); // not even the catalog pull rode
    } finally {
      world.stop();
    }
  });
});
