// buckle.server.tree.test.ts — COMMIT 4 STEP 3 (test-first): the
// federated tree. Downstream-only: /v1/tree renders self + every
// configured peer's node (pulled with the peer token), peer-of-peer as
// SUMMARIES (bounded by design). A dead peer fails SOFT: label with
// empty models, the tree stays ours.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { bootServer } from "./buckle.server.main.ts";
import { loadSettings } from "./buckle.server.settings.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleTreeResponse } from "../schemas/buckle.tree.zod.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function mintKey(name: string, value: string): string {
  const dir = mkdtempSync(join(tmpdir(), "buckle-keys-"));
  const p = join(dir, name);
  writeFileSync(p, value + "\n");
  chmodSync(p, 0o600);
  return p;
}

function stubProvider(id: string): { port: number; stop: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      if (new URL(req.url).pathname === "/v1/models")
        return Response.json({ data: [{ id }] });
      return new Response("not found", { status: 404 });
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true) };
}

const ACCESS = (id: string) =>
  BuckleAccessRegistry.parse({
    principals: [{ id, kind: "service", groups: [] }],
    grants: [
      { principal: id, scopes: ["models.list", "models.use", "tree.read", "stats.read"] },
    ],
    tiers: [],
  });

async function boot(opts: {
  label: string;
  providerId: string;
  keyPath: string;
  principal: string;
  hubs?: Record<string, { url: string; token_file?: string }>;
}): Promise<{ base: string; stop: () => void }> {
  const provider = stubProvider(opts.providerId);
  const base = await loadSettings({
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, "deploy/settings/b1.settings.json5"),
  });
  const server = bootServer({
    settings: {
      ...base,
      hub: { ...base.hub, label: opts.label },
      keys: { ...(base.keys ?? {}), principals_dir: dirnameOf(opts.keyPath) },
      access: ACCESS(opts.principal),
      hubs: opts.hubs ?? {},
      providers: { openrouter: { url: `http://127.0.0.1:${provider.port}` } },
    },
    port: 0,
  });
  return {
    base: `http://127.0.0.1:${server.port}`,
    stop: () => {
      provider.stop();
      server.stop(true);
    },
  };
}

function dirnameOf(p: string): string {
  return p.slice(0, p.lastIndexOf("/"));
}

const CHAT_AUTH = (key: string) => ({ authorization: `Bearer ${key}` });

describe("COMMIT 4 STEP 3 — the federated tree", () => {
  test("/v1/tree is grant-gated (tree.read); no hubs → peers []", async () => {
    const key = mintKey("principal.root@fleet.test.key", "bksk_root_test");
    const self = await boot({
      label: "b1",
      providerId: "openai/tree-self",
      keyPath: key,
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
    // b3 (leaf) ← b2 (peer of b1) ← b1 (self)
    const b3Key = mintKey("principal.peer3@fleet.test.key", "bksk_b3_test");
    const b3 = await boot({
      label: "b3",
      providerId: "openai/tree-b3",
      keyPath: b3Key,
      principal: "peer3@fleet.test",
    });
    const b2Key = mintKey("principal.peer2@fleet.test.key", "bksk_b2_test");
    const b2 = await boot({
      label: "b2",
      providerId: "openai/tree-b2",
      keyPath: b2Key,
      principal: "peer2@fleet.test",
      hubs: { b3: { url: b3.base, token_file: b3Key } },
    });
    const b1Key = mintKey("principal.peer1@fleet.test.key", "bksk_b1_test");
    const b1 = await boot({
      label: "b1",
      providerId: "openai/tree-b1",
      keyPath: b1Key,
      principal: "peer1@fleet.test",
      hubs: { b2: { url: b2.base, token_file: b2Key } },
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
    const deadToken = mintKey("principal.dead@fleet.test.key", "bksk_dead_test");
    const self = await boot({
      label: "b1",
      providerId: "openai/tree-soft",
      keyPath: deadToken,
      principal: "dead@fleet.test",
      hubs: { gone: { url: "http://127.0.0.1:1", token_file: deadToken } },
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
