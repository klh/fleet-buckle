// buckle.server.federation.test.ts — COMMIT 5 STEP 1 (test-first): the
// federated catalog. /v1/models = own provider rows + downstream peers'
// rows (pulled with the peer token, origin kind=buckle), filtered per
// principal by grant.peers (absent = every configured peer — the
// matrix's carol). Downstream only: peers never appear unless configured.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { bootServer } from "./buckle.server.main.ts";
import { loadSettings } from "./buckle.server.settings.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleProblem } from "../schemas/buckle.problem.zod.ts";
import { BuckleModelWire } from "../schemas/buckle.model.wire.zod.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function keyDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "buckle-keys-"));
  const mint = (name: string, value: string) => {
    const p = join(dir, name);
    writeFileSync(p, value + "\n");
    chmodSync(p, 0o600);
  };
  mint("principal.alice@fleet.key", "bksk_alice");
  mint("principal.bob@fleet.key", "bksk_bob");
  mint("principal.carol@fleet.key", "bksk_carol");
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

async function booted(dir: string, b3: string) {
  const provider = stubProvider([{ id: "openai/own-model" }]);
  const base = await loadSettings({
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, "deploy/settings/b1.settings.json5"),
  });
  const server = bootServer({
    settings: {
      ...base,
      hub: { ...base.hub, label: "b1" },
      keys: { ...(base.keys ?? {}), principals_dir: dir },
      access: BuckleAccessRegistry.parse({
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
      }),
      hubs: { b3: { url: b3, token_file: join(dir, "peer-b3.token") } },
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

async function bootPeer(dir: string): Promise<{ base: string; stop: () => void }> {
  const provider = stubProvider([{ id: "openai/peer-model" }]);
  const base = await loadSettings({
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, "deploy/settings/b1.settings.json5"),
  });
  const server = bootServer({
    settings: {
      ...base,
      hub: { ...base.hub, label: "b3" },
      keys: { ...(base.keys ?? {}), principals_dir: dir },
      access: BuckleAccessRegistry.parse({
        principals: [{ id: "federation@fleet", kind: "service", groups: [] }],
        grants: [{ principal: "federation@fleet", scopes: ["models.list"] }],
        tiers: [],
      }),
      hubs: {},
      providers: { zai: { url: `http://127.0.0.1:${provider.port}` } },
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

describe("COMMIT 5 STEP 1 — the federated catalog (the matrix views)", () => {
  test("alice: own ONLY · bob: own+b3 · carol: every peer", async () => {
    const dir = keyDir();
    const peer = await bootPeer(dir);
    const self = await booted(dir, peer.base);
    try {
      const view = async (key: string): Promise<BuckleModelWire[]> => {
        const r = await fetch(`${self.base}/v1/models`, {
          headers: { authorization: `Bearer ${key}` },
        });
        expect(r.status).toBe(200);
        const body = (await r.json()) as { models: BuckleModelWire[] };
        return body.models;
      };
      const alice = await view("bksk_alice");
      expect(alice.map((m) => m.id)).toEqual(["openai/own-model"]);

      const bob = await view("bksk_bob");
      expect(bob.map((m) => m.id).sort()).toEqual([
        "openai/own-model",
        "openai/peer-model",
      ]);
      expect(
        bob.find((m) => m.id === "openai/peer-model")?.origin,
      ).toEqual({ kind: "buckle", label: "b3", url: peer.base });

      const carol = await view("bksk_carol");
      expect(carol.map((m) => m.id).sort()).toEqual([
        "openai/own-model",
        "openai/peer-model",
      ]);
    } finally {
      self.stop();
      peer.stop();
    }
  });

  test("peer rows need models.list AT THE HOP (federation token)", async () => {
    const dir = keyDir();
    // peer WITHOUT the federation grant → pulls 401 → peer rows absent
    const provider = stubProvider([{ id: "openai/peer-model" }]);
    const base = await loadSettings({
      defaults: join(ROOT, "deploy/settings/default.settings.json5"),
      settings: join(ROOT, "deploy/settings/b1.settings.json5"),
    });
    const peer = bootServer({
      settings: {
        ...base,
        hub: { ...base.hub, label: "b3" },
        keys: { ...(base.keys ?? {}), principals_dir: dir },
        access: BuckleAccessRegistry.parse({ principals: [], grants: [], tiers: [] }),
        hubs: {},
        providers: { zai: { url: `http://127.0.0.1:${provider.port}` } },
      },
      port: 0,
    });
    const self = await booted(dir, `http://127.0.0.1:${peer.port}`);
    try {
      const r = await fetch(`${self.base}/v1/models`, {
        headers: { authorization: "Bearer bksk_carol" },
      });
      const body = (await r.json()) as { models: string[] | { id: string }[] };
      expect(
        (body.models as { id: string }[]).map((m) => m.id),
      ).toEqual(["openai/own-model"]); // hop denied → own rows only
    } finally {
      self.stop();
      peer.stop(true);
      provider.stop();
    }
  });
});
