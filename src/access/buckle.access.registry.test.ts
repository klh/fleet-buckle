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

import { engineKeyFor, resolveCredential } from "./buckle.access.registry.ts";
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";

describe("engine key shape", () => {
  const acc = BuckleAccessRegistry.parse({
    principals: [
      { id: "alice@fleet", kind: "human", byoc_key_path: "/run/s/alice", limits: { max_budget: 5, budget_duration: "30d" } },
      { id: "bob@fleet", kind: "human", byoc_key_path: "/run/s/bob", revoked: true },
      { id: "svc@fleet", kind: "service" },
      { id: "adm@fleet", kind: "developer" },
    ],
    grants: [
      { principal: "alice@fleet", scopes: ["models.use"] },
      { principal: "bob@fleet", scopes: ["models.use"] },
      { principal: "adm@fleet", scopes: ["admin"] },
      { principal: "svc@fleet", scopes: ["models.use"] },
    ],
  });
  const s = { access: acc } as unknown as BuckleSettings;
  test("quota shape, deny, revoke, isolation", () => {
    const a = engineKeyFor(s, "alice@fleet", "/w");
    expect(a.ok && a.key.maxBudget).toBe(5);
    expect(a.ok && a.key.keyPath).toBe("/run/s/alice");
    expect(engineKeyFor(s, "bob@fleet", "/w")).toMatchObject({ ok: false, status: 401 });
    expect(engineKeyFor(s, null, "/w")).toMatchObject({ ok: false, status: 401 });
    expect(engineKeyFor(s, "adm@fleet", "/w")).toMatchObject({ ok: false, status: 403 });
    const v = engineKeyFor(s, "alice@fleet", "/w");
    if (v.ok) expect(v.key.routeFamilies).not.toContain("admin" as never);
    const sv = engineKeyFor(s, "svc@fleet", "/w");
    expect(sv.ok && sv.key.keyPath).not.toBe("/run/s/alice");
  });
  test("BYOC failure never falls back; db failure fail-closed", () => {
    const a = engineKeyFor(s, "alice@fleet", "/w");
    if (!a.ok) throw new Error("x");
    expect(resolveCredential(a.key, "human", () => null, "/w/worker")).toEqual({ ok: false, status: 401 });
    expect(resolveCredential(a.key, "human", () => { throw new Error("db"); })).toEqual({ ok: false, status: 503 });
  });
});

import { test as t2, expect as e2 } from "bun:test";
import { authenticate as auth2, holdsScope as hs2, scopedTokenReader as str2 } from "./buckle.access.registry.ts";
t2("regression: revoked principal never authenticates or holds scope; scoped engine key isolates users", () => {
  const s: any = { keys: { engine: "/m", principals_dir: "/nonexistent" }, access: { principals: [
    { id: "a", kind: "worker", revoked: true, groups: [] }, { id: "b", kind: "worker", revoked: false, groups: [] }],
    grants: [{ principal: "a", scopes: ["models.use"] }, { principal: "b", scopes: ["models.use"] }], tiers: [] } };
  e2(hs2(s, "a", "models.use")).toBe(false);
  e2(hs2(s, "b", "models.use")).toBe(true);
  e2(auth2(s, "bksk_x")).toBe(null);
  const base = (p: string) => ({ "/m": "MASTER", "/nonexistent/engine.a.key": "KA", "/nonexistent/engine.b.key": "KB" } as any)[p] ?? null;
  e2(str2(s, "b", base)("/m")).toBe("KB");
  e2(str2(s, "a", base)("/m")).toBe("KA");
  e2(str2(s, "b", (p: string) => (p === "/m" ? "MASTER" : null))("/m")).toBe(null);
});

import { virtualKeyBody } from "./buckle.access.registry.ts";
import { admitBudget } from "../admission/buckle.admission.limits.ts";

describe("virtual key body + budget", () => {
  const acc = BuckleAccessRegistry.parse({
    principals: [
      { id: "svc@fleet", kind: "service", groups: ["t1"], limits: { max_budget: 2, max_rpm: 5 } },
      { id: "adm@fleet", kind: "developer" },
    ],
    grants: [
      { principal: "svc@fleet", scopes: ["models.use"] },
      { principal: "adm@fleet", scopes: ["admin"] },
    ],
  });
  const s = { access: acc } as unknown as BuckleSettings;
  test("scoped per principal; admin/unknown denied", () => {
    expect(virtualKeyBody(s, "svc@fleet", "/w")).toMatchObject({ user_id: "svc@fleet", team_id: "t1", max_budget: 2, rpm_limit: 5 });
    expect(virtualKeyBody(s, "adm@fleet", "/w")).toBeNull();
    expect(virtualKeyBody(s, "nobody", "/w")).toBeNull();
  });
  test("budget quota and DB failure", () => {
    expect(admitBudget(2, 1).allowed).toBe(true);
    expect(admitBudget(2, 2)).toMatchObject({ allowed: false, status: 429 });
    expect(admitBudget(2, null)).toMatchObject({ allowed: false, status: 503 });
    expect(admitBudget(undefined, null).allowed).toBe(true);
  });
});
