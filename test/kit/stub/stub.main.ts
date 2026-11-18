// stub.main.ts — the provider stub: serves /models fixture rows,
// answers /v1/chat/completions body-AWARE (a first system message
// carrying CONTEXT-MARK answers "injected" — the context-injection
// e2e's oracle), and serves the engine TELEMETRY face (/metrics
// prom-text + the litellm spend endpoints) so the stats fold can
// surface real engine telemetry. Runs in Docker inside the demo
// stack; each compose stub gets its fixture by STUB_FIXTURE env
// (file PATH).
import { readFileSync } from "node:fs";

const fixturePath = process.env["STUB_FIXTURE"] ?? "/etc/stub/models.json";

let rows: unknown = { data: [] };
try {
  rows = JSON.parse(readFileSync(fixturePath, "utf8"));
} catch {
  // no fixture mounted = empty catalog; the stub still serves
}

let chats = 0;
/** per-key call counts for the 429 fault mode */
const faults = new Map<string, number>();

/** the AGENT-CONTRACT oracle: the durable worker asks three STRICT
 *  JSON questions (classify / pin-down / implement). The provider stub
 *  answers them deterministically so the worker cycle is provable
 *  hermetically. A contract answer is AUTHORITATIVE — checked before
 *  and never overridden by the CONTEXT-MARK oracle (a lane rule may
 *  inject a system stanza into the very same request; the worker must
 *  still get its JSON). */
const seen: {
  at: number;
  face: string;
  model: string;
  systemMark: boolean;
  system: string | null;
  contract: string | null;
  /** the credential that arrived (BYOC proofs: whose token rode) */
  auth: string | null;
  /** the copilot seat's integration id, when the caller sent one */
  copilotId: string | null;
  /** who made the ride (BYOC-through-the-engine proofs: litellm's UA) */
  ua: string | null;
}[] = [];

function recordSeen(
  face: string,
  model: string,
  systemMark: boolean,
  contract: string | null,
  system: string | null,
  auth: string | null = null,
  copilotId: string | null = null,
  ua: string | null = null,
): void {
  seen.push({ at: Date.now(), face, model, systemMark, system, contract, auth, copilotId, ua });
  if (seen.length > 100) seen.splice(0, seen.length - 100);
}

function agentContractAnswer(messages: readonly unknown[]): { text: string; kind: string } | null {
  const texts: string[] = [];
  for (const m of messages) {
    if (
      typeof m === "object" &&
      m !== null &&
      "content" in m &&
      typeof (m as { content: unknown }).content === "string"
    )
      texts.push((m as { content: string }).content);
  }
  const joined = texts.join("\n");
  if (joined.includes("Classify this GitHub issue"))
    return { text: JSON.stringify({ kind: "feature" }), kind: "classify" };
  if (joined.includes("Ask the 1-4 pin-down questions"))
    return {
      text: JSON.stringify({
        questions: [
          "What should the marker page title be?",
          "Should it link back to the issue that asked for it?",
        ],
      }),
      kind: "questions",
    };
  if (joined.includes("You are implementing a GitHub issue")) {
    const n = /issue #(\d+)/.exec(joined)?.[1] ?? "0";
    return {
      text: JSON.stringify({
        summary: "Add the agent e2e marker page",
        files: [
          {
            path: `docs/agent-e2e-${n}.md`,
            content: `# Agent e2e marker\n\nWritten by the durable worker cycle (issue #${n}).\n`,
          },
        ],
      }),
      kind: "implement",
    };
  }
  return null;
}

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: 8080,
  fetch: async (req) => {
    const { pathname } = new URL(req.url);
    // SEAT-SHAPED ROUTES: the live Copilot seat is not path-uniform
    // (chat rides BARE /chat/completions, responses BARE /responses,
    // anthropic keeps /v1/messages) — the registry's byoc_routes rows
    // forward those exact shapes, so this stub accepts BOTH the
    // openai-standard and the seat-shaped spellings (same handler:
    // one behavior, two route tables)
    const seatPath =
      pathname === "/chat/completions"
        ? "/v1/chat/completions"
        : pathname === "/responses"
          ? "/v1/responses"
          : pathname;
    if (req.method === "GET" && seatPath === "/models")
      return Response.json(rows, { headers: { "cache-control": "no-store" } });
    // the EVIDENCE ring: what this stub actually SAW (the worker e2e
    // asserts the lane pin + context injection from here — never from
    // hand-typed expectations)
    if (req.method === "GET" && seatPath === "/_seen")
      return Response.json({ seen }, { headers: { "cache-control": "no-store" } });
    if (req.method === "POST" && seatPath === "/v1/chat/completions") {
      chats += 1;
      // the oracle: injection is visible in the ANSWER — a
      // system-first body carrying the mark answers "injected",
      // everything else answers "plain". Castless structural
      // narrowing (in-guards): the stub image carries no deps
      let answer = "plain";
      let model = "stub-chat";
      let wantStream = false;
      let faultKey: string | null = null;
      let contract: string | null = null;
      let systemMark = false;
      let systemHead: string | null = null;
      try {
        const body: unknown = JSON.parse(await req.text());
        if (
          typeof body === "object" &&
          body !== null &&
          "messages" in body &&
          Array.isArray(body.messages)
        ) {
          const hit = agentContractAnswer(body.messages);
          if (hit !== null) {
            answer = hit.text;
            contract = hit.kind;
          }
          const first: unknown = body.messages[0];
          if (
            typeof first === "object" &&
            first !== null &&
            "role" in first &&
            "content" in first &&
            first.role === "system" &&
            typeof first.content === "string"
          ) {
            systemHead = first.content.slice(0, 100);
            if (first.content.includes("CONTEXT-MARK")) systemMark = true;
          }
          // the mark answer only when NO contract claimed it (the
          // worker must always get its JSON back)
          if (systemMark && contract === null) answer = "injected";
        }
        // B14 stub modes: `stream:true` answers SSE; a user message
        // carrying STUB-FAULT-429:<key> answers 429 + Retry-After on the
        // first call per key, then succeeds (bounded-retry oracle)
        if (typeof body === "object" && body !== null) {
          if ("stream" in body && body.stream === true) wantStream = true;
          const m = JSON.stringify("messages" in body ? body.messages : "");
          faultKey = /STUB-FAULT-429:([\w-]+)/.exec(m)?.[1] ?? null;
        }
        // the LANE-PIN oracle: the model the engine actually received
        // (the pin wins over the body — the response echoes it)
        if (
          typeof body === "object" &&
          body !== null &&
          "model" in body &&
          typeof body.model === "string"
        )
          model = body.model;
      } catch {
        // non-JSON body: still a passthrough stub
      }
      recordSeen("chat", model, systemMark, contract, systemHead, req.headers.get("authorization"), req.headers.get("copilot-integration-id"), req.headers.get("user-agent"));
      if (faultKey !== null) {
        faults.set(faultKey, (faults.get(faultKey) ?? 0) + 1);
        if (faults.get(faultKey) === 1)
          return Response.json(
            { error: { message: "stub rate limit", type: "rate_limit_error" } },
            { status: 429, headers: { "retry-after": "1" } },
          );
      }
      if (wantStream) {
        const enc = new TextEncoder();
        const chunk = (delta: object, finish: string | null): string =>
          `data: ${JSON.stringify({ id: "stub-chat", object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
        const parts = [
          chunk({ role: "assistant", content: "stub " }, null),
          chunk({ content: "stream" }, null),
          chunk({}, "stop"),
          "data: [DONE]\n\n",
        ];
        return new Response(
          new ReadableStream({
            start(c) {
              for (const x of parts) c.enqueue(enc.encode(x));
              c.close();
            },
          }),
          { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } },
        );
      }
      return Response.json({
        id: "stub-chat",
        object: "chat.completion",
        model,
        choices: [{ index: 0, message: { role: "assistant", content: answer } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    // the ANTHROPIC dialect oracle: top-level `system` carrying the
    // mark answers "injected" (the /v1/messages injection seam)
    if (req.method === "POST" && seatPath === "/v1/messages") {
      let answer = "plain";
      let model = "stub-messages";
      let contract: string | null = null;
      let systemMark = false;
      let systemHead: string | null = null;
      try {
        const body: unknown = JSON.parse(await req.text());
        if (
          typeof body === "object" &&
          body !== null &&
          "system" in body &&
          typeof body.system === "string"
        ) {
          systemHead = body.system.slice(0, 100);
          if (body.system.includes("CONTEXT-MARK")) systemMark = true;
        }
        if (
          typeof body === "object" &&
          body !== null &&
          "model" in body &&
          typeof body.model === "string"
        )
          model = body.model;
        if (
          typeof body === "object" &&
          body !== null &&
          "messages" in body &&
          Array.isArray(body.messages)
        ) {
          const hit = agentContractAnswer(body.messages);
          if (hit !== null) {
            answer = hit.text;
            contract = hit.kind;
          }
        }
        if (systemMark && contract === null) answer = "injected";
      } catch {
        // non-JSON body: still a passthrough stub
      }
      recordSeen("messages", model, systemMark, contract, systemHead, req.headers.get("authorization"), req.headers.get("copilot-integration-id"), req.headers.get("user-agent"));
      return Response.json({
        id: "stub-msg",
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text: answer }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    }
    // the RESPONSES-API face: litellm translates the anthropic
    // /v1/messages dialect onto the OpenAI /v1/responses wire for
    // openai legs (instructions carries the injected system stanza) —
    // without this face the dialect round trip cannot complete
    if (req.method === "POST" && seatPath === "/v1/responses") {
      let answer = "plain";
      let model = "stub-responses";
      let contract: string | null = null;
      let systemMark = false;
      let systemHead: string | null = null;
      try {
        const body: unknown = JSON.parse(await req.text());
        if (
          typeof body === "object" &&
          body !== null &&
          "instructions" in body &&
          typeof body.instructions === "string"
        ) {
          systemHead = body.instructions.slice(0, 100);
          if (body.instructions.includes("CONTEXT-MARK")) systemMark = true;
        }
        if (
          typeof body === "object" &&
          body !== null &&
          "model" in body &&
          typeof body.model === "string"
        )
          model = body.model;
        if (
          typeof body === "object" &&
          body !== null &&
          "input" in body &&
          Array.isArray(body.input)
        ) {
          const texts: unknown[] = [];
          for (const item of body.input) {
            if (
              typeof item === "object" &&
              item !== null &&
              "content" in item &&
              Array.isArray((item as { content: unknown }).content)
            )
              for (const part of (item as { content: unknown[] }).content)
                if (
                  typeof part === "object" &&
                  part !== null &&
                  "text" in part &&
                  typeof (part as { text: unknown }).text === "string"
                )
                  texts.push((part as { text: string }).text);
          }
          const items = texts.map((t) => ({ role: "user", content: t }));
          const hit = agentContractAnswer(items);
          if (hit !== null) {
            answer = hit.text;
            contract = hit.kind;
          }
        }
        if (systemMark && contract === null) answer = "injected";
      } catch {
        // non-JSON body: still a passthrough stub
      }
      recordSeen("responses", model, systemMark, contract, systemHead, req.headers.get("authorization"), req.headers.get("copilot-integration-id"), req.headers.get("user-agent"));
      return Response.json({
        id: "resp-stub",
        object: "response",
        created_at: 1,
        status: "completed",
        model,
        output: [
          {
            type: "message",
            id: "msg-stub",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: answer, annotations: [] }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
    }
    if (req.method === "GET" && seatPath === "/metrics")
      return new Response(
        `# TYPE stub_engine_requests_total counter\nstub_engine_requests_total ${chats}\n# TYPE stub_engine_latency_ms gauge\nstub_engine_latency_ms 12\n`,
        { headers: { "content-type": "text/plain" } },
      );
    if (req.method === "GET" && seatPath === "/global/spend")
      return Response.json(
        { spend: 0.42, max_budget: 100 },
        { headers: { "cache-control": "no-store" } },
      );
    if (req.method === "GET" && seatPath === "/global/spend/models")
      return Response.json(
        { data: [{ model: "stub-model", total_spend: 0.42 }] },
        { headers: { "cache-control": "no-store" } },
      );
    if (req.method === "GET" && seatPath === "/healthz")
      return Response.json({ ok: true, status: "up" });
    // the PASS-THROUGH oracle: any unhandled face echoes verbatim —
    // method + path + body riding back (the e2e proves buckle
    // relayed it untouched, auth swapped at the gate)
    const echoed = req.method === "GET" || req.method === "HEAD" ? null : await req.text();
    return Response.json({
      echoed: true,
      method: req.method,
      path: pathname,
      ...(echoed !== null ? { body: echoed } : {}),
      ...(req.headers.get("x-litellm-tags") !== null
        ? { tags: req.headers.get("x-litellm-tags") }
        : {}),
    });
  },
});
console.log(`provider stub on ${server.url.href} (fixture: ${fixturePath})`);
