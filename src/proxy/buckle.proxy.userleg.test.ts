// buckle.proxy.userleg.test.ts — the BYOC leg: the caller's
// /w/<lane>/<token> credential is THE upstream credential (relayed
// once, never stored), token-only callers reach BYOC seats and
// NOTHING else, and each token derives its own pseudonymous
// principal (attribution per dev). TWO carriers, engine FIRST:
// with a unit engine the token rides it (litellm forwards the key
// of its keyless BYOC deployment); without one the leg relays the
// seat directly. Worlds ride the kit.
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { bootBuckle, mintKeyDir, stubByocSeat, stubEngine, stubProvider, type AccessRegistry } from "../kit.ts";
import { ENGINE_PATH } from "../context/buckle.context.inject.ts";
import { userIdOf } from "../lane.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleProblem } from "../schemas/buckle.problem.zod.ts";
import { BuckleStatsResponse } from "../schemas/buckle.stats.zod.ts";

const DIR = mintKeyDir({ "principal.wire@fleet.test.key": "bksk_wire_test" });
const AUTH = { authorization: "Bearer bksk_wire_test" };
const ACCESS: AccessRegistry = BuckleAccessRegistry.parse({
  principals: [{ id: "wire@fleet.test", kind: "service", groups: [] }],
  grants: [{ principal: "wire@fleet.test", scopes: ["models.list", "models.use", "stats.read"] }],
  tiers: [],
});

/** two devs' own copilot-seat credentials (the /w/ tokens) */
const PAT_A = "ghp_" + "aaaa2aaaa2aaaa2aaaa2aaaa2aaaa2aaaa2aaaa";
const PAT_B = "ghp_" + "bbbb4bbbb4bbbb4bbbb4bbbb4bbbb4bbbb4bbbb";

const CHAT = (model: string) => ({
  model,
  messages: [{ role: "user", content: "hi" }],
});

const ChatEcho = z.object({ id: z.string() });

/** one world: the copilot BYOC seat + (optionally) an engine stub
 *  + the openrouter catalog (the non-BYOC provider for refusal
 *  proofs). withEngine=false = an engineless unit (direct relay). */
async function booted(withEngine = true) {
  const seat = stubByocSeat([{ id: "mscopilot/gpt-6-astra" }]);
  const openrouter = stubProvider([{ id: "openrouter/qwen3-coder" }]);
  const engine = stubEngine();
  const world = await bootBuckle({
    label: "b1",
    dir: DIR,
    access: ACCESS,
    providers: {
      mscopilot: `http://127.0.0.1:${seat.port}`,
      openrouter: `http://127.0.0.1:${openrouter.port}`,
    },
    hubs: {},
    ...(withEngine ? { engineUrl: `http://127.0.0.1:${engine.port}` } : {}),
  });
  return { world, base: world.base, seat, openrouter, engine };
}

async function chat(base: string, pat: string, model = "mscopilot/gpt-6-astra"): Promise<Response> {
  return fetch(`${base}/w/copilot/${pat}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CHAT(model)),
  });
}

/** only the CHAT rides (the catalog /models pull is its own ride) */
const RideSchema = z.object({
  path: z.string(),
  auth: z.string().nullable(),
  copilotId: z.string().nullable(),
  raw: z.string(),
});
const chatRides = (seen: unknown[]) =>
  RideSchema.array().parse(seen).filter((s) => s.path.includes("/chat/completions"));

describe("the BYOC leg (/w/<lane>/<token>)", () => {
  test("WITH an engine: the token rides the ENGINE, verbatim (buckle serves through it)", async () => {
    const { world, base, seat, openrouter, engine } = await booted(true);
    try {
      const r = await chat(base, PAT_A);
      expect(r.status).toBe(200);
      const body = ChatEcho.parse(await r.json());
      expect(body.id).toBe("engine-echo"); // the ENGINE answered — it fronts the seat
      const rides = chatRides(engine.seen);
      expect(rides.length).toBe(1);
      // the BYOC path convention — the engine's pass-through row
      expect(rides[0]?.path).toBe(`/v1/byoc/mscopilot${ENGINE_PATH.chat}`);
      expect(rides[0]?.auth).toBe(`Bearer ${PAT_A}`); // THEIR token reached the engine
      // registry headers ride the engine leg TOO (forward_headers
      // relays them; Copilot 400s /v1/messages without the integration id)
      expect(rides[0]?.copilotId).toBe("vscode-chat");
      expect(chatRides(seat.seen).length).toBe(0); // the seat leg is the engine's, not buckle's
    } finally {
      world.stop();
      seat.stop();
      openrouter.stop();
      engine.stop();
    }
  });

  test("WITHOUT an engine: the token relays the seat DIRECT (verbatim + registry headers)", async () => {
    const { world, base, seat, openrouter, engine } = await booted(false);
    try {
      const r = await chat(base, PAT_A);
      expect(r.status).toBe(200);
      const body = ChatEcho.parse(await r.json());
      expect(body.id).toBe("copilot-seat-echo"); // the seat's own answer, not rewritten
      const rides = chatRides(seat.seen);
      expect(rides.length).toBe(1);
      expect(rides[0]?.auth).toBe(`Bearer ${PAT_A}`); // THEIR token reached the seat
      expect(rides[0]?.copilotId).toBe("vscode-chat"); // registry headers attached
      expect(JSON.parse(rides[0]?.raw ?? "{}")).toEqual(CHAT("mscopilot/gpt-6-astra"));
      expect(engine.seen.length).toBe(0); // no engine — nothing to ride
    } finally {
      world.stop();
      seat.stop();
      openrouter.stop();
      engine.stop();
    }
  });

  test("each token is its own pseudonymous principal (attribution per dev)", async () => {
    const { world, base, seat, openrouter, engine } = await booted(true);
    try {
      expect((await chat(base, PAT_A)).status).toBe(200);
      expect((await chat(base, PAT_B)).status).toBe(200);
      const rides = chatRides(engine.seen).map((s) => s.auth);
      expect(rides).toEqual([`Bearer ${PAT_A}`, `Bearer ${PAT_B}`]);
      const stats = BuckleStatsResponse.parse(
        await (await fetch(`${base}/v1/stats`, { headers: AUTH })).json(),
      );
      const ids = stats.self.principals.map((p) => p.principal);
      expect(ids).toContain(userIdOf(PAT_A));
      expect(ids).toContain(userIdOf(PAT_B));
      expect(userIdOf(PAT_A)).not.toBe(userIdOf(PAT_B));
    } finally {
      world.stop();
      seat.stop();
      openrouter.stop();
      engine.stop();
    }
  });

  test("a token is NOT a principal key: non-BYOC models refuse it", async () => {
    const { world, base, seat, openrouter, engine } = await booted(true);
    try {
      // the engine provider's model through a token-only caller
      const r = await chat(base, PAT_A, "openrouter/qwen3-coder");
      expect(r.status).toBe(401);
      expect(r.headers.get("content-type")).toContain("application/problem+json");
      const problem = BuckleProblem.parse(await r.json());
      expect(problem.kind).toBe("unauthenticated");
      expect(chatRides(engine.seen).length).toBe(0); // never reached the engine
      expect(chatRides(seat.seen).length).toBe(0); // never reached the seat
    } finally {
      world.stop();
      seat.stop();
      openrouter.stop();
      engine.stop();
    }
  });

  test("without a token a BYOC model is invisible — the refusal NAMES the contract", async () => {
    const { world, base, seat, openrouter, engine } = await booted(true);
    try {
      const r = await fetch(`${base}/w/copilot/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body: JSON.stringify(CHAT("mscopilot/gpt-6-astra")),
      });
      // its catalog rides the caller's token: without one the model
      // is unknown — and the detail teaches /w/<lane>/<token>
      expect(r.status).toBe(404);
      const problem = BuckleProblem.parse(await r.json());
      expect(problem.kind).toBe("not-found");
      expect(problem.detail ?? "").toContain("/w/<lane>/<token>");
      expect(chatRides(seat.seen).length).toBe(0);
    } finally {
      world.stop();
      seat.stop();
      openrouter.stop();
      engine.stop();
    }
  });

  test("with the catalog warm, the BYOC gate refuses a tokenless caller 401", async () => {
    const { world, base, seat, openrouter, engine } = await booted(true);
    try {
      // a dev pulls the seat's catalog first (their token warms it)
      expect((await chat(base, PAT_B)).status).toBe(200);
      // a tokenless keyed caller now resolves the model — the gate fires
      const r = await fetch(`${base}/w/copilot/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body: JSON.stringify(CHAT("mscopilot/gpt-6-astra")),
      });
      expect(r.status).toBe(401);
      const problem = BuckleProblem.parse(await r.json());
      expect(problem.kind).toBe("unauthenticated");
      expect(problem.detail ?? "").toContain("BYOC");
      // the tokenless ask never rode a leg
      expect(chatRides(engine.seen).length).toBe(1);
      expect(chatRides(engine.seen)[0]?.auth).toBe(`Bearer ${PAT_B}`);
    } finally {
      world.stop();
      seat.stop();
      openrouter.stop();
      engine.stop();
    }
  });

  test("a keyed caller may ALSO carry a token (key + BYOC both ride)", async () => {
    const { world, base, seat, openrouter, engine } = await booted(true);
    try {
      const r = await fetch(`${base}/w/copilot/${PAT_A}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body: JSON.stringify(CHAT("mscopilot/gpt-6-astra")),
      });
      expect(r.status).toBe(200);
      // the caller's token reaches the engine — never the buckle key
      expect(chatRides(engine.seen)[0]?.auth).toBe(`Bearer ${PAT_A}`);
      expect(chatRides(seat.seen).length).toBe(0);
    } finally {
      world.stop();
      seat.stop();
      openrouter.stop();
      engine.stop();
    }
  });
});
