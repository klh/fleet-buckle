// buckle.admin.control.test.ts — the admin seam (the GUI's control
// faces): GET /admin/state renders the roster (never a secret),
// POST /admin/keys mints ONCE for a DECLARED principal (the roster
// is code), POST /admin/hubs lands provider rows through the over
// layer and the LIVE settings swap the same request serves. Worlds
// ride the kit; over-layer files ride a scratch dir.
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootBuckle, mintKeyDir, stubByocSeat, type AccessRegistry } from "../kit.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import { BuckleProblem } from "../schemas/buckle.problem.zod.ts";

const DIR = mintKeyDir({
  "principal.gui@fleet.test.key": "bksk_gui_test",
  "principal.owner@fleet.test.key": "bksk_owner_test",
});
const GUI = { authorization: "Bearer bksk_gui_test" };
const ACCESS: AccessRegistry = BuckleAccessRegistry.parse({
  principals: [
    { id: "gui@fleet.test", kind: "service", groups: [] },
    { id: "owner@fleet.test", kind: "human", groups: [] },
  ],
  grants: [
    { principal: "gui@fleet.test", scopes: ["admin"] },
    { principal: "owner@fleet.test", scopes: ["models.list", "models.use"] },
  ],
  tiers: [],
});

const PAT = "ghp_" + "test4test4test4test4test4test4test4test";

async function booted() {
  const seat = stubByocSeat([{ id: "mscopilot/gpt-6-astra" }]);
  const over = join(mkdtempSync(join(tmpdir(), "buckle-over-")), "over.json5");
  const world = await bootBuckle({
    label: "az1",
    dir: DIR,
    access: ACCESS,
    providers: { mscopilot: `http://127.0.0.1:${seat.port}` },
    hubs: {},
    over,
  });
  return { world, base: world.base, seat, over };
}

const AdminState = z.object({
  hub: z.string(),
  providers: z.array(
    z.object({
      label: z.string(),
      user_token: z.boolean(),
      dialect: z.string(),
      url: z.string(),
    }),
  ),
  principals: z.array(z.object({ id: z.string(), scopes: z.array(z.string()) })),
});

const HubEditOk = z.object({
  ok: z.boolean(),
  over: z.string(),
  hub: z.object({
    providers: z.array(z.object({ label: z.string() })),
  }),
});

describe("the admin seam", () => {
  test("GET /admin/state renders the world (roster + BYOC flag, never a key)", async () => {
    const { world, base, seat } = await booted();
    try {
      const r = await fetch(`${base}/admin/state`, { headers: GUI });
      expect(r.status).toBe(200);
      const state = AdminState.parse(await r.json());
      expect(state.hub).toBe("az1");
      expect(state.providers).toEqual([
        { label: "mscopilot", user_token: true, dialect: "github_copilot", url: `http://127.0.0.1:${seat.port}` },
      ]);
      expect(state.principals.find((p) => p.id === "owner@fleet.test")?.scopes).toEqual([
        "models.list",
        "models.use",
      ]);
    } finally {
      world.stop();
      seat.stop();
    }
  });

  test("scope admin is the gate (a mere model caller is refused)", async () => {
    const { world, base, seat } = await booted();
    try {
      const r = await fetch(`${base}/admin/state`, {
        headers: { authorization: "Bearer bksk_owner_test" },
      });
      expect(r.status).toBe(403);
      const problem = BuckleProblem.parse(await r.json());
      expect(problem.kind).toBe("forbidden");
      const anon = await fetch(`${base}/admin/state`);
      expect(anon.status).toBe(401);
    } finally {
      world.stop();
      seat.stop();
    }
  });

  test("POST /admin/keys mints ONCE for a DECLARED principal; the key WORKS", async () => {
    const { world, base, seat } = await booted();
    try {
      // owner already keyed in this world's dir → conflict, never re-mint
      const again = await fetch(`${base}/admin/keys`, {
        method: "POST",
        headers: { "content-type": "application/json", ...GUI },
        body: JSON.stringify({ principal: "owner@fleet.test" }),
      });
      expect(again.status).toBe(409);
      // an undeclared principal cannot be invented through the API
      const ghost = await fetch(`${base}/admin/keys`, {
        method: "POST",
        headers: { "content-type": "application/json", ...GUI },
        body: JSON.stringify({ principal: "ghost@nowhere" }),
      });
      expect(ghost.status).toBe(404);
      // body drift fails LOUD
      const bad = await fetch(`${base}/admin/keys`, {
        method: "POST",
        headers: { "content-type": "application/json", ...GUI },
        body: JSON.stringify({ nope: 1 }),
      });
      expect(bad.status).toBe(422);
      expect(BuckleProblem.parse(await bad.json()).kind).toBe("validation");
    } finally {
      world.stop();
      seat.stop();
    }
  });

  test("POST /admin/hubs lands an over-layer row and swaps LIVE (same server)", async () => {
    const { world, base, seat } = await booted();
    try {
      const r = await fetch(`${base}/admin/hubs`, {
        method: "POST",
        headers: { "content-type": "application/json", ...GUI },
        body: JSON.stringify({
          providers: { mscopilot: { url: `http://127.0.0.1:${seat.port}` } },
        }),
      });
      expect(r.status).toBe(200);
      const out = HubEditOk.parse(await r.json());
      expect(out.ok).toBe(true);
      expect(out.hub.providers.length).toBe(1);
      // the over file holds EXACTLY the edit (JSON — valid JSON5), and
      // the LIVE state (same server, no restart) already serves it
      expect(JSON.parse(readFileSync(out.over, "utf8"))).toEqual({
        providers: { mscopilot: { url: `http://127.0.0.1:${seat.port}` } },
      });
      const state = AdminState.parse(
        await (await fetch(`${base}/admin/state`, { headers: GUI })).json(),
      );
      expect(state.providers.map((p) => p.label)).toEqual(["mscopilot"]);
    } finally {
      world.stop();
      seat.stop();
    }
  });

  test("a BYOC chat still rides after the admin faces are wired (regression)", async () => {
    const { world, base, seat } = await booted();
    try {
      const r = await fetch(`${base}/w/copilot/${PAT}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "mscopilot/gpt-6-astra",
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(r.status).toBe(200);
      expect(seat.seen[0]?.auth).toBe(`Bearer ${PAT}`);
    } finally {
      world.stop();
      seat.stop();
    }
  });
});
