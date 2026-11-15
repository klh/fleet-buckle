// gui.main.ts — the azure GUI shell: serves the static console and
// proxies /api/* to the buckle admin faces with the GUI principal
// key (a 0600 file, read PER REQUEST — key rotation never restarts).
// The GUI holds NO credentials of its own beyond that key: BYOC
// tokens ride user requests (/w/<lane>/<token>) and never pass here.
//
// FRONT DOOR: when OIDC_ISSUER + OIDC_CLIENT_ID are set, /api/* is
// gated behind a device-code login (any OIDC IdP — Entra is one
// issuer string) and the session cookie seals VERIFIED claims only.
// Unset = open ops face (tabula-rasa default); the azure deploy sets
// both. The buckle wire itself (/w/…) is NEVER behind this door.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pollDeviceToken, startDeviceLogin, verifyIdToken } from "./gui.oidc.ts";
import { clearSessionCookie, mintSessionCookie, readSession } from "./gui.session.ts";

const BUCKLE_URL = process.env["BUCKLE_URL"] ?? "http://buckle:4111";
const KEY_FILE = process.env["GUI_KEY_FILE"] ?? "/state/keys/principal.gui@azure.key";
const OIDC_ISSUER = process.env["OIDC_ISSUER"] ?? "";
const OIDC_CLIENT_ID = process.env["OIDC_CLIENT_ID"] ?? "";
const LOGIN_GATED = OIDC_ISSUER !== "" && OIDC_CLIENT_ID !== "";

function guiKey(): string | null {
  try {
    const value = readFileSync(KEY_FILE, "utf8").trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

type ApiRoute = { method: string; path: string; body?: unknown };

async function proxy(route: ApiRoute): Promise<Response> {
  const key = guiKey();
  if (key === null) return Response.json({ error: "gui key not minted yet" }, { status: 503 });
  const res = await fetch(`${BUCKLE_URL}${route.path}`, {
    method: route.method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(route.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }),
  });
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
  });
}

/** live device logins — handle in, device_code NEVER out (memory
 *  only: single-instance GUI; a restart re-logs-in, sessions survive
 *  — they are sealed, not stored) */
const logins = new Map<string, { deviceCode: string; expiresAt: number }>();

function loginStart(): Promise<Response> {
  return startDeviceLogin(OIDC_ISSUER, OIDC_CLIENT_ID)
    .then((login) => {
      const handle = randomUUID();
      logins.set(handle, {
        deviceCode: login.device_code,
        expiresAt: Date.now() + login.expires_in * 1000,
      });
      return Response.json({
        handle,
        user_code: login.user_code,
        verification_uri: login.verification_uri,
        ...(login.verification_uri_complete !== undefined
          ? { verification_uri_complete: login.verification_uri_complete }
          : {}),
        interval: login.interval ?? 5,
      });
    })
    .catch((err: unknown) =>
      Response.json({ error: `login start failed: ${String(err)}` }, { status: 502 }),
    );
}

async function loginPoll(handle: string): Promise<Response> {
  const login = logins.get(handle);
  if (login === undefined || login.expiresAt < Date.now()) {
    logins.delete(handle);
    return Response.json({ state: "expired" });
  }
  const poll = await pollDeviceToken(OIDC_ISSUER, OIDC_CLIENT_ID, login.deviceCode);
  if (poll.state === "pending" || poll.state === "slow_down") return Response.json(poll);
  logins.delete(handle); // every terminal poll burns the handle (one code, one session)
  if (poll.state !== "done") return Response.json(poll);
  try {
    const claims = await verifyIdToken(OIDC_ISSUER, OIDC_CLIENT_ID, poll.id_token);
    const cookie = mintSessionCookie(claims.sub, claims.name);
    if (cookie === null)
      return Response.json({ state: "failed", error: "session key missing" }, { status: 503 });
    return Response.json(
      { state: "done", sub: claims.sub, ...(claims.name !== undefined ? { name: claims.name } : {}) },
      { headers: { "set-cookie": cookie } },
    );
  } catch (err: unknown) {
    return Response.json({ state: "failed", error: String(err) });
  }
}

/** the door's own faces — they MINT the session, so they sit before
 *  the gate; returns null when the path is not one of theirs */
async function oidcFace(url: URL, req: Request): Promise<Response | null> {
  if (url.pathname === "/api/oidc/config")
    return Response.json({ enabled: LOGIN_GATED, ...(LOGIN_GATED ? { issuer: OIDC_ISSUER } : {}) });
  if (url.pathname === "/api/oidc/logout" && req.method === "POST")
    return Response.json({ state: "logged-out" }, { headers: { "set-cookie": clearSessionCookie() } });
  if (!LOGIN_GATED) {
    if (url.pathname === "/api/oidc/login" || url.pathname === "/api/oidc/poll")
      return Response.json({ error: "login not configured" }, { status: 503 });
    return null;
  }
  if (url.pathname === "/api/oidc/login" && req.method === "POST") return loginStart();
  if (url.pathname === "/api/oidc/poll" && req.method === "GET")
    return loginPoll(url.searchParams.get("handle") ?? "");
  return null;
}

Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env["PORT"] ?? 8080),
  async fetch(req) {
    const url = new URL(req.url);
    const session = readSession(req.headers.get("cookie"));

    const door = await oidcFace(url, req);
    if (door !== null) return door;

    // the gate: configured front door ⇒ every other /api/* needs the
    // session (oidc/session is the "who am I" the console boots on)
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname === "/api/oidc/session") {
        if (!LOGIN_GATED) return Response.json({ error: "login not configured" }, { status: 503 });
        if (session === null) return Response.json({ error: "session required" }, { status: 401 });
        return Response.json({ sub: session.sub, ...(session.name !== undefined ? { name: session.name } : {}) });
      }
      if (LOGIN_GATED && session === null)
        return Response.json({ error: "session required" }, { status: 401 });
      if (url.pathname === "/api/state") return proxy({ method: "GET", path: "/admin/state" });
      if (url.pathname === "/api/health") return proxy({ method: "GET", path: "/healthz" });
      if (url.pathname === "/api/stats") return proxy({ method: "GET", path: "/v1/stats" });
      if (url.pathname === "/api/keys" && req.method === "POST")
        return proxy({ method: "POST", path: "/admin/keys", body: await req.json().catch(() => null) });
      if (url.pathname === "/api/hubs" && req.method === "POST")
        return proxy({ method: "POST", path: "/admin/hubs", body: await req.json().catch(() => null) });
      return new Response("not found", { status: 404 });
    }

    // static shell (index.html, console.js, console.css, vendored lit)
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const asset = Bun.file(new URL(`./www/${file}`, import.meta.url).pathname);
    if (await asset.exists()) return new Response(asset);
    return new Response("not found", { status: 404 });
  },
});
console.log(
  `buckle gui on :${Number(process.env["PORT"] ?? 8080)} → ${BUCKLE_URL}` +
    (LOGIN_GATED ? ` · front door: ${OIDC_ISSUER}` : " · front door: open (no OIDC configured)"),
);
