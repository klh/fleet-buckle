// buckle.catalog.view.test.ts — the federated catalog views:
// /v1/models = own provider rows + downstream peers' DIRECT rows,
// filtered per principal by grant.peers (absent = every configured
// peer — the matrix's carol). Downstream only. The catalog is a SET.
import { describe, expect, test } from "bun:test";
import { bootBuckle, mintKeyDir, stubProvider, type AccessRegistry } from "../kit.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleModelWire, BuckleModelsResponse } from "../schemas/buckle.model.wire.zod.ts";

/** the matrix's grant population, on one key dir */
const ACCESS: AccessRegistry = BuckleAccessRegistry.parse({
  principals: [
    { id: "alice@fleet", kind: "human", groups: [] },
    { id: "bob@fleet", kind: "human", groups: [] },
    { id: "carol@fleet", kind: "developer", groups: ["platform"] },
    { id: "federation@fleet", kind: "service", groups: [] },
  ],
  grants: [
    // alice: own rows ONLY (explicit empty peer list)
    { principal: "alice@fleet", scopes: ["models.list", "models.use"], peers: [] },
    // bob: own + b3 (the matrix's openrouter+zai shape)
    { principal: "bob@fleet", scopes: ["models.list", "models.use"], peers: ["b3"] },
    // carol: peers omitted = every configured peer
    { principal: "carol@fleet", scopes: ["models.list", "models.use"] },
    // the hop identity: models.list is checked per hop
    { principal: "federation@fleet", scopes: ["models.list"] },
  ],
  tiers: [],
});

const PEER_ACCESS: AccessRegistry = BuckleAccessRegistry.parse({
  principals: [{ id: "federation@fleet", kind: "service", groups: [] }],
  grants: [{ principal: "federation@fleet", scopes: ["models.list"] }],
  tiers: [],
});

function matrixKeyDir(): string {
  return mintKeyDir({
    "principal.alice@fleet.key": "bksk_alice",
    "principal.bob@fleet.key": "bksk_bob",
    "principal.carol@fleet.key": "bksk_carol",
    "principal.federation@fleet.key": "bksk_federation",
    "peer-b2.token": "bksk_federation",
    "peer-b3.token": "bksk_federation",
  });
}

/** b1: the head of the matrix (own provider rows + configured peers) */
async function bootHead(
  dir: string,
  hubs: Record<string, string>,
  ownRows: { id: string }[] = [{ id: "openai/own-model" }],
): Promise<{ base: string; stop: () => void }> {
  const provider = stubProvider(ownRows);
  const world = await bootBuckle({
    label: "b1",
    dir,
    access: ACCESS,
    providers: { openrouter: `http://127.0.0.1:${provider.port}` },
    hubs,
  });
  return {
    base: world.base,
    stop: () => {
      world.stop();
      provider.stop();
    },
  };
}

/** a downstream peer (minimal federation access, zai provider) */
async function bootPeer(
  dir: string,
  opts: {
    label?: string;
    rows?: { id: string }[];
    hubs?: Record<string, string>;
    access?: AccessRegistry;
  } = {},
): Promise<{ base: string; stop: () => void }> {
  const provider = stubProvider(opts.rows ?? [{ id: "openai/peer-model" }]);
  const world = await bootBuckle({
    label: opts.label ?? "b3",
    dir,
    access: opts.access ?? PEER_ACCESS,
    providers: { zai: `http://127.0.0.1:${provider.port}` },
    ...(opts.hubs === undefined ? {} : { hubs: opts.hubs }),
  });
  return {
    base: world.base,
    stop: () => {
      world.stop();
      provider.stop();
    },
  };
}

describe("the federated catalog (the matrix views)", () => {
  test("alice: own ONLY · bob: own+b3 · carol: every peer", async () => {
    const dir = matrixKeyDir();
    const peer = await bootPeer(dir);
    const self = await bootHead(dir, { b3: peer.base });
    try {
      const view = async (key: string): Promise<BuckleModelWire[]> => {
        const r = await fetch(`${self.base}/v1/models`, {
          headers: { authorization: `Bearer ${key}` },
        });
        expect(r.status).toBe(200);
        const body = BuckleModelsResponse.parse(await r.json());
        return body.models;
      };
      const alice = await view("bksk_alice");
      expect(alice.map((m) => m.id)).toEqual(["openai/own-model"]);

      const bob = await view("bksk_bob");
      expect(bob.map((m) => m.id).sort()).toEqual(["openai/own-model", "openai/peer-model"]);
      expect(bob.find((m) => m.id === "openai/peer-model")?.origin).toEqual({
        kind: "buckle",
        label: "b3",
        url: peer.base,
      });

      const carol = await view("bksk_carol");
      expect(carol.map((m) => m.id).sort()).toEqual(["openai/own-model", "openai/peer-model"]);
    } finally {
      self.stop();
      peer.stop();
    }
  });

  test("peer rows need models.list AT THE HOP (federation token)", async () => {
    const dir = matrixKeyDir();
    // peer WITHOUT the federation grant → pulls 401 → peer rows absent
    const peer = await bootPeer(dir, {
      access: BuckleAccessRegistry.parse({ principals: [], grants: [], tiers: [] }),
    });
    const self = await bootHead(dir, { b3: peer.base });
    try {
      const r = await fetch(`${self.base}/v1/models`, {
        headers: { authorization: "Bearer bksk_carol" },
      });
      const body = BuckleModelsResponse.parse(await r.json());
      expect(body.models.map((m) => m.id)).toEqual(["openai/own-model"]); // hop denied → own rows only
    } finally {
      self.stop();
      peer.stop();
    }
  });

  test("the catalog is a SET — an id served by own + two peers lists ONCE (own wins, then hubs order)", async () => {
    const dir = matrixKeyDir();
    const b2 = await bootPeer(dir, {
      label: "b2",
      rows: [{ id: "openai/own-shared" }, { id: "openai/peer-shared" }],
    });
    const b3 = await bootPeer(dir, {
      rows: [
        { id: "openai/own-shared" },
        { id: "openai/peer-shared" },
        { id: "openai/peer-model" },
      ],
    });
    const self = await bootHead(dir, { b2: b2.base, b3: b3.base }, [
      { id: "openai/own-model" },
      { id: "openai/own-shared" },
    ]);
    try {
      const r = await fetch(`${self.base}/v1/models`, {
        headers: { authorization: "Bearer bksk_carol" }, // carol: every peer
      });
      expect(r.status).toBe(200);
      const body = BuckleModelsResponse.parse(await r.json());
      const ids = body.models.map((m) => m.id);
      // however many hubs serve an id, the row appears exactly once
      expect(ids.length).toBe(new Set(ids).size);
      expect([...ids].sort()).toEqual([
        "openai/own-model",
        "openai/own-shared",
        "openai/peer-model",
        "openai/peer-shared",
      ]);
      // own beats peers: never hop for what we serve
      expect(body.models.find((m) => m.id === "openai/own-shared")?.origin).toMatchObject({
        kind: "provider",
      });
      // among peers, hubs-declaration order (b2 before b3) wins
      expect(body.models.find((m) => m.id === "openai/peer-shared")?.origin).toMatchObject({
        kind: "buckle",
        label: "b2",
      });
    } finally {
      self.stop();
      b2.stop();
      b3.stop();
    }
  });

  test("transit rows never re-enter: b1→b2 does not inherit b2's b3 rows", async () => {
    const dir = matrixKeyDir();
    const b3 = await bootPeer(dir, { rows: [{ id: "openai/deep-model" }] });
    // b2 peers b3 → b2's OWN federation view carries deep-model …
    const b2 = await bootPeer(dir, { label: "b2", hubs: { b3: b3.base } });
    const self = await bootHead(dir, { b2: b2.base });
    try {
      const atB2 = await fetch(`${b2.base}/v1/models`, {
        headers: { authorization: "Bearer bksk_federation" },
      });
      const b2body = BuckleModelsResponse.parse(await atB2.json());
      expect(b2body.models.map((m) => m.id)).toContain("openai/deep-model");

      // … but b1's view does NOT: only the peer's DIRECT rows ride —
      // a hub configured with b1+b2+b3 peers never counts b3 twice
      const r = await fetch(`${self.base}/v1/models`, {
        headers: { authorization: "Bearer bksk_carol" },
      });
      const body = BuckleModelsResponse.parse(await r.json());
      expect(body.models.map((m) => m.id).sort()).toEqual([
        "openai/own-model",
        "openai/peer-model",
      ]);
    } finally {
      self.stop();
      b2.stop();
      b3.stop();
    }
  });
});
