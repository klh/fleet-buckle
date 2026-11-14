// buckle.catalog.topology.test.ts — the federated TREE: /v1/tree is
// grant-gated (tree.read); no hubs → peers []; depth-2 peers render
// as summaries (bounded walk); a dead peer fails SOFT. Worlds ride
// the kit; responses parse through BuckleTreeResponse.
import { describe, expect, test } from "bun:test";
import { bootBuckle, mintKeyDir, stubProvider, type AccessRegistry } from "../kit.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleTreeResponse } from "../schemas/buckle.tree.zod.ts";

const DIR = mintKeyDir({
  "principal.root@fleet.test.key": "bksk_root_test",
  "principal.peer1@fleet.test.key": "bksk_b1_test",
  "principal.peer2@fleet.test.key": "bksk_b2_test",
  "principal.peer3@fleet.test.key": "bksk_b3_test",
  "principal.dead@fleet.test.key": "bksk_dead_test",
  // hub tokens ride the kit convention: <dir>/peer-<label>.token,
  // VALUE matching the peer's principal key so the peer resolves us
  "peer-b2.token": "bksk_b2_test",
  "peer-b3.token": "bksk_b3_test",
});

const ACCESS = (id: string): AccessRegistry =>
  BuckleAccessRegistry.parse({
    principals: [{ id, kind: "service", groups: [] }],
    grants: [{ principal: id, scopes: ["models.list", "models.use", "tree.read", "stats.read"] }],
    tiers: [],
  });

const CHAT_AUTH = (key: string) => ({ authorization: `Bearer ${key}` });

async function boot(opts: {
  label: string;
  providerId: string;
  principal: string;
  hubs?: Record<string, string>;
}): Promise<{ base: string; stop: () => void }> {
  const provider = stubProvider([{ id: opts.providerId }]);
  const world = await bootBuckle({
    label: opts.label,
    dir: DIR,
    access: ACCESS(opts.principal),
    providers: { openrouter: `http://127.0.0.1:${provider.port}` },
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

describe("the federated tree", () => {
  test("/v1/tree is grant-gated (tree.read); no hubs → peers []", async () => {
    const self = await boot({
      label: "b1",
      providerId: "openai/tree-self",
      principal: "root@fleet.test",
    });
    try {
      expect((await fetch(`${self.base}/v1/tree`)).status).toBe(401);
      const r = await fetch(`${self.base}/v1/tree`, {
        headers: CHAT_AUTH("bksk_root_test"),
      });
      expect(r.status).toBe(200);
      const tree = BuckleTreeResponse.parse(await r.json());
      expect(tree.self.buckle.label).toBe("b1");
      expect(tree.self.models.map((m) => m.id)).toEqual(["openai/tree-self"]);
      expect(tree.self.peers).toEqual([]);
      expect(tree.self.stats?.current_connections).toBeGreaterThanOrEqual(0);
    } finally {
      self.stop();
    }
  });

  test("depth 2: self renders peer nodes; peer-of-peer as SUMMARIES", async () => {
    // b3 (leaf) ← b2 (peer of b1) ← b1 (self) — one shared key dir,
    // hub tokens resolve to peer-<label>.token (kit convention)
    const b3 = await boot({
      label: "b3",
      providerId: "openai/tree-b3",
      principal: "peer3@fleet.test",
    });
    const b2 = await boot({
      label: "b2",
      providerId: "openai/tree-b2",
      principal: "peer2@fleet.test",
      hubs: { b3: b3.base },
    });
    const b1 = await boot({
      label: "b1",
      providerId: "openai/tree-b1",
      principal: "peer1@fleet.test",
      hubs: { b2: b2.base },
    });
    try {
      const r = await fetch(`${b1.base}/v1/tree`, {
        headers: CHAT_AUTH("bksk_b1_test"),
      });
      const tree = BuckleTreeResponse.parse(await r.json());
      expect(tree.self.peers.length).toBe(1);
      const b2Node = tree.self.peers[0]!;
      expect(b2Node.buckle.label).toBe("b2");
      expect(b2Node.models.map((m) => m.id)).toEqual(["openai/tree-b2"]);
      // b3 arrives as a SUMMARY (bounded walk: no connections up here)
      expect(b2Node.peers.length).toBe(1);
      const b3Summary = b2Node.peers[0]!;
      expect(b3Summary.buckle.label).toBe("b3");
      expect(b3Summary.models.map((m) => m.id)).toEqual(["openai/tree-b3"]);
      expect("connections" in b3Summary).toBe(false);
    } finally {
      b1.stop();
      b2.stop();
      b3.stop();
    }
  });

  test("a dead peer fails SOFT — label + empty models, tree stays ours", async () => {
    const self = await boot({
      label: "b1",
      providerId: "openai/tree-soft",
      principal: "dead@fleet.test",
      hubs: { gone: "http://127.0.0.1:1" },
    });
    try {
      const r = await fetch(`${self.base}/v1/tree`, {
        headers: CHAT_AUTH("bksk_dead_test"),
      });
      expect(r.status).toBe(200);
      const tree = BuckleTreeResponse.parse(await r.json());
      expect(tree.self.peers.length).toBe(1);
      expect(tree.self.peers[0]!.buckle.label).toBe("gone");
      expect(tree.self.peers[0]!.models).toEqual([]);
    } finally {
      self.stop();
    }
  });
});
