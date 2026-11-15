// buckle.e2e.azure.spec.ts — the TABULA RASA topology end-to-end: the
// azure hub (BYOC mscopilot + GUI + owner) on Docker against the
// mscopilot stub. Proves the whole developer story: one URL carrying
// lane + token, the seat sees THEIR credential (never a buckle key),
// two devs are two pseudonymous principals, the GUI serves state /
// stats / key-conflicts through its principal key, and a provider
// edit lands through /admin/hubs LIVE (over layer, no restart).
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { composeOn } from "../kit/buckle.kit.compose.ts";
import { z } from "zod";

const Healthz = z.object({ label: z.string() });

const Refusal = z.object({ detail: z.string().optional() });

const StatsView = z.object({
  self: z.object({ principals: z.array(z.object({ principal: z.string() })) }),
});

const ModelsView = z.object({ models: z.array(z.object({ id: z.string() })) });

const GuiState = z.object({
  hub: z.string(),
  providers: z.array(
    z.object({
      label: z.string(),
      user_token: z.boolean(),
      dialect: z.string(),
      url: z.string(),
    }),
  ),
});

const DeviceLogin = z.object({
  handle: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  interval: z.number(),
});

const PollState = z.object({ state: z.enum(["pending", "slow_down", "done", "expired", "failed"]) });

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FILE = "test/deploy/compose.azure.test.yaml";
const PROJECT = "fleet-buckle-azure";
const compose = (...args: string[]) => composeOn(FILE, PROJECT, ...args);

const GUI = "http://127.0.0.1:4761";
const HUB = "http://127.0.0.1:4762";
const SEEN = "http://127.0.0.1:4764";

/** two devs' own copilot-seat credentials (the /w/ tokens) */
const PAT_A = "ghp_" + "e2e4e2e4e2e4e2e4e2e4e2e4e2e4e2e4e2e4";
const PAT_B = "ghp_" + "dev2dev2dev2dev2dev2dev2dev2dev2dev2dev";
// catalog ids are RAW (the seat's own ids — the catalog is verbatim)
const MODEL = "gpt-6-astra";

const CHAT = (model: string) => ({
  model,
  messages: [{ role: "user", content: "hi" }],
});

async function byocChat(base: string, pat: string, model = MODEL) {
  return fetch(`${base}/w/copilot/${pat}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CHAT(model)),
  });
}

/** the client order every real CLI rides: list (warms the seat's
 * catalog with THIS token), then chat */
async function byocWarm(base: string, pat: string): Promise<Response> {
  return fetch(`${base}/w/copilot/${pat}/v1/models`, {
    headers: { authorization: `Bearer ${pat}` },
  });
}

const SeatEvidence = z.object({
  seen: z.array(
    z.object({
      auth: z.string().nullable(),
      copilotId: z.string().nullable(),
      model: z.string(),
      ua: z.string().nullable(),
    }),
  ),
});

/** the stub's evidence face — what the SEAT saw arrive */
async function seen() {
  const r = await fetch(`${SEEN}/_seen`);
  return SeatEvidence.parse(await r.json()).seen;
}

let guiKey = "";
let ownerKey = "";
let sessionCookie = ""; // the GUI session sealed by the OIDC front door

const OIDC = "http://127.0.0.1:4766"; // the stub IdP's approve face
const withSession = (extra: Record<string, string> = {}): Record<string, string> => ({
  cookie: sessionCookie,
  ...extra,
});

test.describe.serial("the azure tabula-rasa hub", () => {
  test.beforeAll(() => {
    // the engine config is GENERATED from the same fixture the stub
    // serves (catalog and legs can never drift) — before compose up
    execFileSync("bun", ["tools/src/buckle.gen-engine-config.ts"], {
      cwd: ROOT,
      stdio: "inherit",
    });
    // mint the declared principals into the bind-mounted keys dir
    // (the exact one-shot bootstrap production rides, local paths)
    execFileSync(
      "bun",
      [
        "tools/src/buckle.azure-mint.ts",
        "test/deploy/keys/.azure",
        "deploy/settings/default.settings.json5",
        "test/deploy/settings/azure.settings.json5",
      ],
      { cwd: ROOT, stdio: "inherit" },
    );
    guiKey = readFileSync(`${ROOT}/test/deploy/keys/.azure/principal.gui@azure.key`, "utf8").trim();
    ownerKey = readFileSync(`${ROOT}/test/deploy/keys/.azure/principal.owner@azure.key`, "utf8").trim();
    compose("up", "-d", "--build");
  });

  test.afterAll(() => {
    compose("down", "-v", "--remove-orphans");
  });

  test("the hub is up and the GUI shell serves", async () => {
    const h = await fetch(`${HUB}/healthz`);
    expect(h.status).toBe(200);
    expect(Healthz.parse(await h.json()).label).toBe("azure");
    const shell = await fetch(`${GUI}/`);
    expect(shell.status).toBe(200);
    expect((await shell.text())).toContain("buckle-console");
    const js = await fetch(`${GUI}/console.js`);
    expect(js.status).toBe(200);
  });

  test("the engine's BYOC pass-through forwards the caller's token (no key of its own)", async () => {
    // litellm boots slower than buckle: poll the liveliness face
    // (bounded — a dead engine fails the test, never hangs it). Poll
    // fn is TOTAL (throws become 0) — expect.poll does not catch.
    await expect
      .poll(
        async () => {
          try {
            return (await fetch("http://127.0.0.1:4765/health/liveliness")).status;
          } catch {
            return 0;
          }
        },
        { timeout: 60_000, intervals: [1_000] },
      )
      .toBe(200);
    // the pass-through seam DIRECTLY: the caller's bearer forwards
    // verbatim (the engine holds no key — the token IS the credential)
    const r = await fetch("http://127.0.0.1:4765/v1/byoc/mscopilot/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${PAT_A}` },
      body: JSON.stringify(CHAT(MODEL)),
    });
    expect(r.status).toBe(200);
    const rides = (await seen()).filter((s) => s.auth !== null);
    expect(rides.at(-1)?.auth).toBe(`Bearer ${PAT_A}`);
  });

  test("a dev rides ONE url: their token reaches the seat THROUGH the engine, verbatim", async () => {
    const warm = await byocWarm(HUB, PAT_A);
    expect(warm.status).toBe(200);
    const r = await byocChat(HUB, PAT_A);
    expect(r.status).toBe(200);
    // THROUGH THE ENGINE — buckle synthesizes its responses (upstream
    // headers never ride through), so the ENGINE's own access log is
    // the honest witness: the pass-through face answered the chat
    const logs = execFileSync(
      "docker",
      [
        "compose",
        "-f",
        FILE,
        "-p",
        PROJECT,
        "logs",
        "--no-log-prefix",
        "engine",
      ],
      { encoding: "utf8", cwd: ROOT },
    );
    expect(logs).toContain("POST /v1/byoc/mscopilot/v1/chat/completions HTTP/1.1\" 200");
    const rides = (await seen()).filter((s) => s.auth !== null);
    expect(rides.length).toBeGreaterThan(0);
    expect(rides.at(-1)?.auth).toBe(`Bearer ${PAT_A}`); // THEIR token arrived
    expect(rides.at(-1)?.copilotId).toBe("vscode-chat"); // registry headers on the pass-through
    expect(rides.at(-1)?.model).toBe(MODEL);
  });

  test("two devs are two pseudonymous principals (no identity stored)", async () => {
    await byocWarm(HUB, PAT_B);
    await byocChat(HUB, PAT_B);
    const rides = (await seen()).filter((s) => s.auth !== null);
    const bearers = new Set(rides.map((s) => s.auth));
    expect(bearers.has(`Bearer ${PAT_A}`)).toBe(true);
    expect(bearers.has(`Bearer ${PAT_B}`)).toBe(true);
  });

  test("a tokenless caller is taught the contract (BYOC catalog rides tokens)", async () => {
    const r = await fetch(`${HUB}/w/copilot/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ownerKey}` },
      body: JSON.stringify(CHAT("mscopilot-model-that-no-seat-lists")),
    });
    // catalog cold for the tokenless caller: the model is invisible…
    expect(r.status).toBe(404);
    const refused = Refusal.parse(await r.json());
    expect(refused.detail ?? "").toContain("/w/<lane>/<token>");
  });

  test("the OIDC front door: device-code login gates the /api seam", async () => {
    // closed before login — and a FORGED seal is refused (HMAC)
    expect((await fetch(`${GUI}/api/state`)).status).toBe(401);
    const forged = await fetch(`${GUI}/api/state`, {
      headers: { cookie: "buckle_session=Zm9yZ2Vk.aGVyZQ" },
    });
    expect(forged.status).toBe(401);
    // start the device flow at the GUI (against the stub IdP in-net)
    const start = await fetch(`${GUI}/api/oidc/login`, { method: "POST" });
    expect(start.status).toBe(200);
    const startBody = z.record(z.string(), z.unknown()).parse(await start.json());
    const login = DeviceLogin.parse(startBody);
    expect(login.user_code).toBe("STUB-2468");
    expect(Object.keys(startBody)).not.toContain("device_code"); // grant secret stays server-side
    // still pending until the human approves at the IdP
    const before = PollState.parse(await (await fetch(`${GUI}/api/oidc/poll?handle=${login.handle}`)).json());
    expect(before.state).toBe("pending");
    // the "human" approves — the rig's test face, keyed by the PUBLIC user_code
    const approve = await fetch(`${OIDC}/_approve?user_code=${login.user_code}`, { method: "POST" });
    expect(approve.status).toBe(200);
    // the next poll seals the session (Set-Cookie rides the response)
    const poll = await fetch(`${GUI}/api/oidc/poll?handle=${login.handle}`);
    const done = PollState.parse(await poll.json());
    expect(done.state).toBe("done");
    sessionCookie = poll.headers.get("set-cookie") ?? "";
    expect(sessionCookie.startsWith("buckle_session=")).toBe(true);
    // the session opens the seam + carries the VERIFIED claims
    const state = await fetch(`${GUI}/api/state`, { headers: withSession() });
    expect(state.status).toBe(200);
    expect(GuiState.parse(await state.json()).hub).toBe("azure");
    const who = await fetch(`${GUI}/api/oidc/session`, { headers: withSession() });
    expect(who.status).toBe(200);
    expect(z.object({ sub: z.string() }).parse(await who.json()).sub).toBe("stub-dev-1");
  });

  test("the GUI proxies state/health/stats with ITS principal key", async () => {
    const state = GuiState.parse(
      await (await fetch(`${GUI}/api/state`, { headers: withSession() })).json(),
    );
    expect(state.hub).toBe("azure");
    expect(state.providers).toEqual([
      { label: "mscopilot", user_token: true, dialect: "github_copilot", url: "http://mscopilot-stub:8080" },
    ]);
    const health = await fetch(`${GUI}/api/health`, { headers: withSession() });
    expect(health.status).toBe(200);
    const stats = StatsView.parse(
      await (await fetch(`${GUI}/api/stats`, { headers: withSession() })).json(),
    );
    const users = stats.self.principals.map((p) => p.principal).filter((p) => p.startsWith("user:"));
    expect(users.length).toBe(2); // PAT_A and PAT_B — the pseudonymous rows
  });

  test("the GUI cannot mint over an existing key (conflict, never re-mint)", async () => {
    const r = await fetch(`${GUI}/api/keys`, {
      method: "POST",
      headers: withSession({ "content-type": "application/json" }),
      body: JSON.stringify({ principal: "owner@azure" }),
    });
    expect(r.status).toBe(409); // already keyed by the bootstrap mint
    const ghost = await fetch(`${GUI}/api/keys`, {
      method: "POST",
      headers: withSession({ "content-type": "application/json" }),
      body: JSON.stringify({ principal: "ghost@nowhere" }),
    });
    expect(ghost.status).toBe(404); // the roster is code
  });

  test("a provider edit lands LIVE through the GUI (over layer, no restart)", async () => {
    const r = await fetch(`${GUI}/api/hubs`, {
      method: "POST",
      headers: withSession({ "content-type": "application/json" }),
      body: JSON.stringify({
        providers: { openrouter: { url: "http://openrouter-stub:8080" } },
      }),
    });
    expect(r.status).toBe(200);
    const state = GuiState.parse(
      await (await fetch(`${GUI}/api/state`, { headers: withSession() })).json(),
    );
    expect(state.providers.map((p) => p.label).sort()).toEqual(["mscopilot", "openrouter"]);
    // the swap is LIVE: the owner's keyed /v1/models now carries the
    // openrouter catalog rows (fetched with the unit's non-BYOC leg;
    // ids are the seat's OWN verbatim ids — gemini proves the set)
    const models = await fetch(`${HUB}/v1/models`, {
      headers: { authorization: `Bearer ${ownerKey}` },
    });
    expect(models.status).toBe(200);
    const ids = ModelsView.parse(await models.json()).models.map((m) => m.id);
    expect(ids).toContain("google/gemini-4-hydrogen");
    // BYOC rides unchanged after the swap
    const chat = await byocChat(HUB, PAT_A);
    expect(chat.status).toBe(200);
  });

  test("the GUI seam is keyed: no key, no state (fail closed)", async () => {
    // the GUI itself always rides its key file; the buckle face it
    // proxies to refuses anonymous callers — proven direct:
    const anon = await fetch(`${HUB}/admin/state`);
    expect(anon.status).toBe(401);
    expect(guiKey.startsWith("bksk_")).toBe(true); // minted, never typed
  });

  test("logout closes the door again (and BYOC lanes never needed it)", async () => {
    const out = await fetch(`${GUI}/api/oidc/logout`, { method: "POST" });
    expect(out.status).toBe(200);
    const cleared = out.headers.get("set-cookie") ?? "";
    expect(cleared).toContain("Max-Age=0");
    // the OLD cookie stays sealed-but-dead only client-side; the seam
    // itself still honors it until expiry — logout clears the BROWSER.
    // The wire (/w/…) was never behind this door:
    const chat = await byocChat(HUB, PAT_A);
    expect(chat.status).toBe(200);
  });
});
