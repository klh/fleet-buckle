// stub.main.ts — the provider stub: serves /models fixture rows,
// answers /v1/chat/completions body-AWARE (a first system message
// carrying CONTEXT-MARK answers "injected" — the context-injection
// e2e's oracle), and serves the engine TELEMETRY face (/metrics
// prom-text + the litellm spend endpoints) so the stats fold can
// surface real engine telemetry. Runs in Docker inside the demo
// stack; each compose stub gets its fixture by STUB_FIXTURE env
// (file PATH).
import { readFileSync } from "node:fs";

const fixturePath =
  process.env["STUB_FIXTURE"] ?? "/etc/stub/models.json";

let rows: unknown = { data: [] };
try {
  rows = JSON.parse(readFileSync(fixturePath, "utf8"));
} catch {
  // no fixture mounted = empty catalog; the stub still serves
}

let chats = 0;

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: 8080,
  fetch: async (req) => {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/models")
      return Response.json(rows, { headers: { "cache-control": "no-store" } });
    if (req.method === "POST" && pathname === "/v1/chat/completions") {
      chats += 1;
      // the oracle: injection is visible in the ANSWER — a
      // system-first body carrying the mark answers "injected",
      // everything else answers "plain". Castless structural
      // narrowing (in-guards): the stub image carries no deps
      let answer = "plain";
      try {
        const body: unknown = JSON.parse(await req.text());
        if (
          typeof body === "object" && body !== null && "messages" in body &&
          Array.isArray(body.messages)
        ) {
          const first: unknown = body.messages[0];
          if (
            typeof first === "object" && first !== null &&
            "role" in first && "content" in first &&
            first.role === "system" && typeof first.content === "string" &&
            first.content.includes("CONTEXT-MARK")
          )
            answer = "injected";
        }
      } catch {
        // non-JSON body: still a passthrough stub
      }
      return Response.json({
        id: "stub-chat",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: answer } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    if (req.method === "GET" && pathname === "/metrics")
      return new Response(
        `# TYPE stub_engine_requests_total counter\nstub_engine_requests_total ${chats}\n# TYPE stub_engine_latency_ms gauge\nstub_engine_latency_ms 12\n`,
        { headers: { "content-type": "text/plain" } },
      );
    if (req.method === "GET" && pathname === "/global/spend")
      return Response.json(
        { spend: 0.42, max_budget: 100 },
        { headers: { "cache-control": "no-store" } },
      );
    if (req.method === "GET" && pathname === "/global/spend/models")
      return Response.json(
        { data: [{ model: "stub-model", total_spend: 0.42 }] },
        { headers: { "cache-control": "no-store" } },
      );
    if (req.method === "GET" && pathname === "/healthz")
      return Response.json({ ok: true, status: "up" });
    return new Response("not found", { status: 404 });
  },
});
console.log(`provider stub on ${server.url.href} (fixture: ${fixturePath})`);
