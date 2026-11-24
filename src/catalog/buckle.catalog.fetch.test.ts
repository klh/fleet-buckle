// buckle.catalog.fetch.test.ts — P0.2b catalog denial matrix at the
// unit seam: BYOC catalogs are PER-USER. The stub seat answers a
// DIFFERENT catalog per bearer, so cross-user cache reuse is directly
// observable. What must hold (tasks/plan.md P0.2b):
//   1. a caller's PAT lists only that caller's entitled rows — even
//      back-to-back with another caller inside one TTL window;
//   2. a tokenless caller gets honest emptiness (no warm rows fetched
//      under someone else's PAT — the refusal names /w/ upstream);
//   3. a classic (keyed) provider keeps its seat-wide cache (shared);
//   4. no raw credential ever rides a response body.
// Each test uses its own provider label+port: the cache is module
// state, and distinct keys keep tests independent of each other.
import { describe, expect, test } from "bun:test";
import { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { buildCatalog } from "./buckle.catalog.fetch.ts";

// the label rides the REAL registry (mscopilot: user_token by
// default, dialect/chat defaults) — the url alone points at the stub
const settingsOf = (providers: Record<string, unknown>) => {
  const parsed = BuckleSettings.safeParse({ hub: { label: "t" }, providers });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  return parsed.data;
};

const wire = (id: string) => ({ id, object: "model", owned_by: "stub" });

/** a stub seat answering per-bearer catalogs: bearer A → [a1, a2],
 * bearer B → [b1], any other/absent bearer → 401. Records every
 * authorization header it saw so cache behavior (hit vs fetch) is
 * observable without reading module internals. */
const serveSeat = async () => {
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      // the legProvidersOf probe rides /model/info — never counted as a seat pull
      if (new URL(req.url).pathname.endsWith("/model/info")) return Response.json({ data: [] });
      seen.push(req.headers.get("authorization") ?? "(none)");
      const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer /u, "");
      if (bearer === "tok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
        return Response.json({ data: [wire("a1"), wire("a2")] });
      }
      if (bearer === "tok-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") {
        return Response.json({ data: [wire("b1")] });
      }
      // the keyed (classic) leg rides the unit key, not a user PAT
      if (bearer === "sk-unit-key") {
        return Response.json({ data: [wire("shared1")] });
      }
      return new Response("unauthorized", { status: 401 });
    },
  });
  return { server, seen, url: `http://localhost:${server.port}` };
};

describe("catalog BYOC denial matrix (P0.2b)", () => {
  test("one PAT lists only its own rows; a second PAT never reuses them", async () => {
    const seat = await serveSeat();
    const settings = settingsOf({ mscopilot: { url: `${seat.url}` } });
    try {
      const first = await buildCatalog(settings, "00-tr", undefined, "tok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(first.models.map((m) => m.id).sort()).toEqual(["a1", "a2"]);

      // same TTL window, different caller: must fetch with B's PAT,
      // never serve A's cached rows to B
      const second = await buildCatalog(settings, "00-tr", undefined, "tok-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      expect(second.models.map((m) => m.id)).toEqual(["b1"]);

      // and A again, still only A's rows (its own cache entry)
      const again = await buildCatalog(settings, "00-tr", undefined, "tok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(again.models.map((m) => m.id).sort()).toEqual(["a1", "a2"]);

      // exactly TWO seat pulls — one per caller. A's second view is a
      // cache hit on A's OWN key (per-user cache), never B's rows
      expect(seat.seen).toEqual([
        "Bearer tok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "Bearer tok-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ]);
    } finally {
      seat.server.stop(true);
    }
  });

  test("a tokenless caller gets honest emptiness — no one else's warm rows", async () => {
    const seat = await serveSeat();
    const settings = settingsOf({ mscopilot: { url: `${seat.url}` } });
    try {
      // warm the cache under A's PAT first
      const warm = await buildCatalog(settings, "00-tr", undefined, "tok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(warm.models.length).toBe(2);

      // tokenless: honest emptiness, and NO new request to the seat
      const pullsBefore = seat.seen.length;
      const cold = await buildCatalog(settings, "00-tr", undefined, null);
      expect(cold.models).toEqual([]);
      expect(seat.seen.length).toBe(pullsBefore);
    } finally {
      seat.server.stop(true);
    }
  });

  test("a classic (keyed) provider keeps its seat-wide shared cache", async () => {
    const seat = await serveSeat();
    const settings = settingsOf({ mscopilot: { url: `${seat.url}`, key: "/etc/keys/seat.key" } });
    try {
      const tokenOf = () => "sk-unit-key";
      const first = await buildCatalog(settings, "00-tr", tokenOf);
      const second = await buildCatalog(settings, "00-tr", tokenOf);
      expect(first.models.map((m) => m.id)).toEqual(["shared1"]);
      expect(second.models.map((m) => m.id)).toEqual(["shared1"]);
      // TTL hit: the seat saw exactly one keyed pull
      expect(seat.seen).toEqual(["Bearer sk-unit-key"]);
    } finally {
      seat.server.stop(true);
    }
  });

  test("no raw credential rides a catalog response body", async () => {
    const seat = await serveSeat();
    const pat = "tok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const settings = settingsOf({ mscopilot: { url: `${seat.url}` } });
    try {
      const view = await buildCatalog(settings, "00-tr", undefined, pat);
      expect(JSON.stringify(view).includes(pat)).toBe(false);
    } finally {
      seat.server.stop(true);
    }
  });
});

describe("catalog grace knob (rate-limit survival)", () => {
  const settingsTimed = (providers: Record<string, unknown>, timeouts: Record<string, number>) => {
    const parsed = BuckleSettings.safeParse({ hub: { label: "t" }, providers, timeouts });
    if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
    return parsed.data;
  };

  /** a seat that serves one good catalog, then 503s forever */
  const serveThenFail = async () => {
    let good = true;
    const pulls: number[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async () => {
        pulls.push(pulls.length);
        if (!good) return new Response("rate limited", { status: 503 });
        return Response.json({ data: [wire("g1"), wire("g2")] });
      },
    });
    return { server, pulls, break: () => { good = false; } };
  };

  test("custom catalog_grace_ms keeps last-good rows past the ttl-derived grace", async () => {
    const seat = await serveThenFail();
    const pat = "tok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const settings = settingsTimed(
      { mscopilot: { url: `http://localhost:${seat.server.port}` } },
      { catalog_cache_ms: 40, catalog_grace_ms: 60_000 },
    );
    try {
      const warm = await buildCatalog(settings, "00-tr", undefined, pat);
      expect(warm.models.length).toBe(2);
      seat.break();
      await new Promise((r) => setTimeout(r, 120)); // past ttl AND past 3x ttl
      const held = await buildCatalog(settings, "00-tr", undefined, pat);
      expect(held.models.map((m) => m.id).sort()).toEqual(["g1", "g2"]);
    } finally {
      seat.server.stop(true);
    }
  });

  test("default grace (ttl x3) still goes honestly empty", async () => {
    const seat = await serveThenFail();
    const pat = "tok-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const settings = settingsTimed({ mscopilot: { url: `http://localhost:${seat.server.port}` } }, { catalog_cache_ms: 40 });
    try {
      const warm = await buildCatalog(settings, "00-tr", undefined, pat);
      expect(warm.models.length).toBe(2);
      seat.break();
      await new Promise((r) => setTimeout(r, 200)); // past 3x40ms
      const drained = await buildCatalog(settings, "00-tr", undefined, pat);
      expect(drained.models).toEqual([]);
    } finally {
      seat.server.stop(true);
    }
  });
});
