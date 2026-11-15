// gui.main.ts — the azure GUI shell: serves the static console and
// proxies /api/* to the buckle admin faces with the GUI principal
// key (a 0600 file, read PER REQUEST — key rotation never restarts).
// The GUI holds NO credentials of its own beyond that key: BYOC
// tokens ride user requests (/w/<lane>/<token>) and never pass here.
import { readFileSync } from "node:fs";

const BUCKLE_URL = process.env["BUCKLE_URL"] ?? "http://buckle:4111";
const KEY_FILE = process.env["GUI_KEY_FILE"] ?? "/state/keys/principal.gui@azure.key";

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

Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env["PORT"] ?? 8080),
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/state") return proxy({ method: "GET", path: "/admin/state" });
    if (url.pathname === "/api/health") return proxy({ method: "GET", path: "/healthz" });
    if (url.pathname === "/api/stats") return proxy({ method: "GET", path: "/v1/stats" });
    if (url.pathname === "/api/keys" && req.method === "POST")
      return proxy({
        method: "POST",
        path: "/admin/keys",
        body: await req.json().catch(() => null),
      });
    if (url.pathname === "/api/hubs" && req.method === "POST")
      return proxy({
        method: "POST",
        path: "/admin/hubs",
        body: await req.json().catch(() => null),
      });
    // static shell (index.html, console.js, console.css, vendored lit)
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const asset = Bun.file(new URL(`./www/${file}`, import.meta.url).pathname);
    if (await asset.exists()) return new Response(asset);
    return new Response("not found", { status: 404 });
  },
});
console.log(`buckle gui on :${Number(process.env["PORT"] ?? 8080)} → ${BUCKLE_URL}`);
