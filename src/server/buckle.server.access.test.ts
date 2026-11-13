// buckle.server.access.test.ts — COMMIT 4 STEP 1 (test-first): every
// face is authenticated. A principal's key (minted to a 0600 file, one
// per principal under the keys dir — PATHS, never values) authenticates
// as that principal; grants decide the face (models.list here). Drift
// fails loud: problem+json, the eight kinds.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { bootServer } from "./buckle.server.main.ts";
import { loadSettings } from "./buckle.server.settings.ts";
import { BuckleProblem } from "../schemas/buckle.problem.zod.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** mint per-principal key FILES (0600) in a tmp keys dir */
function mintKeys(): { dir: string; alice: string; bob: string } {
  const dir = mkdtempSync(join(tmpdir(), "buckle-keys-"));
  const mint = (name: string, value: string): string => {
    const p = join(dir, name);
    writeFileSync(p, value + "\n");
    chmodSync(p, 0o600);
    return p;
  };
  return {
    dir,
    alice: mint("principal.alice@fleet.key", "bksk_alice_test_key"),
    bob: mint("principal.bob@fleet.key", "bksk_bob_test_key"),
  };
}

async function bootedWithAccess() {
  const keys = mintKeys();
  mkdirSync(join(keys.dir, ".nothing"), { recursive: true });
  const base = await loadSettings({
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, "deploy/settings/b1.settings.json5"),
  });
  const settings = {
    ...base,
    keys: { ...(base.keys ?? {}), principals_dir: keys.dir },
    access: BuckleAccessRegistry.parse({
      principals: [
        { id: "alice@fleet", kind: "human", groups: [] },
        { id: "bob@fleet", kind: "human", groups: [] },
      ],
      grants: [
        { principal: "alice@fleet", scopes: ["models.list", "models.use"] },
      ],
      tiers: [],
    }),
  };
  const server = bootServer({ settings, port: 0 });
  return { server, base: `http://127.0.0.1:${server.port}`, keys };
}

describe("COMMIT 4 STEP 1 — the authenticated faces", () => {
  test("no key → 401 problem unauthenticated", async () => {
    const { server, base } = await bootedWithAccess();
    try {
      const r = await fetch(`${base}/v1/models`);
      expect(r.status).toBe(401);
      expect(r.headers.get("content-type")).toContain("problem+json");
      expect(BuckleProblem.parse(await r.json()).kind).toBe("unauthenticated");
    } finally {
      server.stop(true);
    }
  });

  test("alice's key + models.list grant → 200 catalog", async () => {
    const { server, base, keys } = await bootedWithAccess();
    try {
      const r = await fetch(`${base}/v1/models`, {
        headers: { authorization: `Bearer bksk_alice_test_key` },
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { hub: string };
      expect(body.hub).toBe("b1");
      expect(keys.alice.length).toBeGreaterThan(0); // keys are files
    } finally {
      server.stop(true);
    }
  });

  test("bob's key but NO grant → 403 problem forbidden", async () => {
    const { server, base } = await bootedWithAccess();
    try {
      const r = await fetch(`${base}/v1/models`, {
        headers: { authorization: `Bearer bksk_bob_test_key` },
      });
      expect(r.status).toBe(403);
      expect(BuckleProblem.parse(await r.json()).kind).toBe("forbidden");
    } finally {
      server.stop(true);
    }
  });

  test("unknown key → 401 unauthenticated (never 403 — it is not a principal)", async () => {
    const { server, base } = await bootedWithAccess();
    try {
      const r = await fetch(`${base}/v1/models`, {
        headers: { authorization: "Bearer bksk_nope" },
      });
      expect(r.status).toBe(401);
      expect(BuckleProblem.parse(await r.json()).kind).toBe(
        "unauthenticated",
      );
    } finally {
      server.stop(true);
    }
  });

  test("healthz + metrics stay OPEN (outside-process health law)", async () => {
    const { server, base } = await bootedWithAccess();
    try {
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      expect((await fetch(`${base}/metrics`)).status).toBe(200);
    } finally {
      server.stop(true);
    }
  });
});
