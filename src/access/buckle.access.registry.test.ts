// buckle.access.registry.test.ts — the authenticated faces: a key file
// maps to its principal, a grant maps to its scopes; no key → 401,
// unknown key → 401 (never 403), key-without-grant → 403; healthz +
// metrics stay OPEN (outside-process health law). Worlds ride the kit.
import { describe, expect, test } from "bun:test";
import { bootBuckle, mintKeyDir, stubProvider, type AccessRegistry } from "../kit.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleModelsResponse } from "../schemas/buckle.model.wire.zod.ts";
import { BuckleProblem } from "../schemas/buckle.problem.zod.ts";

const DIR = mintKeyDir({
  "principal.alice@fleet.key": "bksk_alice_test_key",
  "principal.bob@fleet.key": "bksk_bob_test_key",
});
const ACCESS: AccessRegistry = BuckleAccessRegistry.parse({
  principals: [
    { id: "alice@fleet", kind: "human", groups: [] },
    { id: "bob@fleet", kind: "human", groups: [] },
  ],
  grants: [{ principal: "alice@fleet", scopes: ["models.list", "models.use"] }],
  tiers: [],
});

/** one shared world — every face test reuses it (alice/bob/no-key) */
async function booted() {
  const provider = stubProvider([{ id: "openrouter/access-face" }]);
  const world = await bootBuckle({
    label: "b1",
    dir: DIR,
    access: ACCESS,
    providers: { openrouter: `http://127.0.0.1:${provider.port}` },
    hubs: {},
  });
  return {
    base: world.base,
    stop: () => {
      world.stop();
      provider.stop();
    },
  };
}

const modelsWith = (base: string, key?: string) =>
  fetch(`${base}/v1/models`, {
    ...(key === undefined ? {} : { headers: { authorization: `Bearer ${key}` } }),
  });

describe("the authenticated faces", () => {
  test("no key → 401 problem unauthenticated", async () => {
    const { base, stop } = await booted();
    try {
      const r = await modelsWith(base);
      expect(r.status).toBe(401);
      expect(r.headers.get("content-type")).toContain("problem+json");
      expect(BuckleProblem.parse(await r.json()).kind).toBe("unauthenticated");
    } finally {
      stop();
    }
  });

  test("alice's key + models.list grant → 200 catalog", async () => {
    const { base, stop } = await booted();
    try {
      const r = await modelsWith(base, "bksk_alice_test_key");
      expect(r.status).toBe(200);
      const body = BuckleModelsResponse.parse(await r.json());
      expect(body.hub).toBe("b1");
    } finally {
      stop();
    }
  });

  test("bob's key but NO grant → 403 problem forbidden", async () => {
    const { base, stop } = await booted();
    try {
      const r = await modelsWith(base, "bksk_bob_test_key");
      expect(r.status).toBe(403);
      expect(BuckleProblem.parse(await r.json()).kind).toBe("forbidden");
    } finally {
      stop();
    }
  });

  test("unknown key → 401 unauthenticated (never 403 — it is not a principal)", async () => {
    const { base, stop } = await booted();
    try {
      const r = await modelsWith(base, "bksk_nope");
      expect(r.status).toBe(401);
      expect(BuckleProblem.parse(await r.json()).kind).toBe("unauthenticated");
    } finally {
      stop();
    }
  });

  test("healthz + metrics stay OPEN (outside-process health law)", async () => {
    const { base, stop } = await booted();
    try {
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
      expect((await fetch(`${base}/metrics`)).status).toBe(200);
    } finally {
      stop();
    }
  });
});
