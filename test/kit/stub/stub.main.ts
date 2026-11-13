// stub.main.ts — the provider stub: serves /v1/models fixture rows and
// echoes /v1/chat/completions. Runs in Docker inside the demo stack;
// each compose stub gets its fixture by STUB_FIXTURE env (file PATH).
import { readFileSync } from "node:fs";

const fixturePath =
  process.env["STUB_FIXTURE"] ?? "/etc/stub/models.json";

let rows: unknown = { data: [] };
try {
  rows = JSON.parse(readFileSync(fixturePath, "utf8"));
} catch {
  // no fixture mounted = empty catalog; the stub still serves
}

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: 8080,
  fetch: (req) => {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/v1/models")
      return Response.json(rows, { headers: { "cache-control": "no-store" } });
    if (req.method === "POST" && pathname === "/v1/chat/completions")
      return Response.json({
        id: "stub-chat",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "stub" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    if (req.method === "GET" && pathname === "/healthz")
      return Response.json({ ok: true, status: "up" });
    return new Response("not found", { status: 404 });
  },
});
console.log(`provider stub on ${server.url.href} (fixture: ${fixturePath})`);
