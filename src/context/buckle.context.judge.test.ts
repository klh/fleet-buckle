// buckle.context.judge.test.ts — the decision seam's contract: the
// DEFAULT is inert (true — the chain rides verbatim), facts carry
// every judging dimension (who + groups, body start, model, the
// fleet hook's repo/lane/work stamps), rules match with AND
// semantics, first match wins with its id, file stanzas resolve
// ONCE at build, and the body rewrite MERGES a leading system
// message (never duplicates one). Engine telemetry rides here too.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ContextFacts, inertJudge, judgeOf } from "./buckle.context.judge.ts";
import { injectedBodyOf } from "./buckle.context.inject.ts";
import { BuckleContextPolicy, BuckleSettings } from "../schemas/buckle.settings.zod.ts";

const factsOf = (over: Partial<z.output<typeof ContextFacts>> = {}) =>
  ContextFacts.parse({
    route: "chat",
    principal: "carol",
    model: "gpt-6-astra",
    bodyStart: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    ...over,
  });

describe("ContextJudge", () => {
  test("the default is INERT — no policy, no injection", () => {
    expect(inertJudge(factsOf())).toBe(true);
    expect(judgeOf(undefined)(factsOf())).toBe(true);
  });

  test("a rule with no match is the catch-all; first match wins with its id", () => {
    const judge = judgeOf(
      BuckleContextPolicy.parse({
        rules: [
          { id: "first", text: "FIRST" },
          { id: "second", text: "SECOND" },
        ],
      }),
    );
    expect(judge(factsOf())).toEqual({ system: "FIRST", rule: "first" });
  });

  test("every declared dimension must agree (AND) — a miss on any is inert", () => {
    const judge = judgeOf(
      BuckleContextPolicy.parse({
        rules: [
          {
            id: "narrow",
            match: {
              principal: "carol",
              group: "core",
              models: ["gpt-6-astra"],
              bodyContains: "hello",
              repo: "klh/fleet",
              lane: "pi-1",
              work: "W1",
            },
            text: "STANZA",
          },
        ],
      }),
    );
    expect(
      judge(factsOf({ groups: ["core"], repo: "klh/fleet", lane: "pi-1", work: "W1" })),
    ).toEqual({ system: "STANZA", rule: "narrow" });
    // each dimension vetoing alone
    expect(
      judge(
        factsOf({
          principal: "dana",
          groups: ["core"],
          repo: "klh/fleet",
          lane: "pi-1",
          work: "W1",
        }),
      ),
    ).toBe(true);
    expect(judge(factsOf({ groups: ["other"], repo: "klh/fleet", lane: "pi-1", work: "W1" }))).toBe(
      true,
    );
    expect(
      judge(
        factsOf({
          model: "other-model",
          groups: ["core"],
          repo: "klh/fleet",
          lane: "pi-1",
          work: "W1",
        }),
      ),
    ).toBe(true);
    expect(
      judge(factsOf({ groups: ["core"], bodyStart: "no greeting", lane: "pi-1", work: "W1" })),
    ).toBe(true);
    // HONEST RED: absent fleet stamps ⇒ the rule cannot fire, even
    // for the same principal — the trust boundary is the header's
    // provenance, not the key
    expect(judge(factsOf({ groups: ["core"], lane: "pi-1", work: "W1" }))).toBe(true);
    expect(judge(factsOf({ groups: ["core"], repo: "klh/fleet", work: "W1" }))).toBe(true);
    expect(judge(factsOf({ groups: ["core"], repo: "klh/fleet", lane: "pi-1" }))).toBe(true);
  });

  test("model matching is exact OR prefix (group ids)", () => {
    const judge = judgeOf(
      BuckleContextPolicy.parse({ rules: [{ id: "gpt", match: { models: ["gpt"] }, text: "S" }] }),
    );
    expect(judge(factsOf({ model: "gpt-6" }))).toEqual({ system: "S", rule: "gpt" });
    expect(judge(factsOf({ model: "gpt" }))).toEqual({ system: "S", rule: "gpt" });
    expect(judge(factsOf({ model: "qwen/x" }))).toBe(true);
  });

  test("a file stanza is read ONCE at build (boot custody, not on-path)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-"));
    const file = join(dir, "stanza.md");
    writeFileSync(file, "CONTEXT-MARK from file");
    const judge = judgeOf(BuckleContextPolicy.parse({ rules: [{ id: "file", file }] }));
    expect(judge(factsOf())).toEqual({ system: "CONTEXT-MARK from file", rule: "file" });
  });

  test("facts carry the judging info and reject drift", () => {
    expect(() => ContextFacts.parse({ route: "chat", principal: "" })).toThrow();
    expect(
      ContextFacts.parse({
        route: "chat",
        principal: "c",
        model: "m",
        bodyStart: "b",
        repo: "klh/fleet",
        lane: "pi-1",
        work: "W1",
        groups: ["core"],
      }),
    ).toMatchObject({ repo: "klh/fleet", lane: "pi-1", work: "W1", groups: ["core"] });
  });
});

describe("injectedBodyOf (the one sanctioned rewrite)", () => {
  test("openai: absent system — the stanza becomes the FIRST system message", () => {
    const out = JSON.parse(
      injectedBodyOf(
        JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }),
        "STANZA",
        "chat",
      ),
    );
    expect(out.messages[0]).toEqual({ role: "system", content: "STANZA" });
    expect(out.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  test("openai: leading system MERGES — one message, never two", () => {
    const out = JSON.parse(
      injectedBodyOf(
        JSON.stringify({
          messages: [
            { role: "system", content: "KEEP-ME" },
            { role: "user", content: "hi" },
          ],
        }),
        "STANZA",
        "chat",
      ),
    );
    expect(out.messages).toHaveLength(2);
    expect(out.messages[0]).toEqual({ role: "system", content: "STANZA\n\nKEEP-ME" });
  });

  test("openai: part-array system content gains a leading text part", () => {
    const out = JSON.parse(
      injectedBodyOf(
        JSON.stringify({
          messages: [{ role: "system", content: [{ type: "text", text: "KEEP" }] }],
        }),
        "STANZA",
        "chat",
      ),
    );
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].content[0]).toEqual({ type: "text", text: "STANZA" });
    expect(out.messages[0].content[1]).toEqual({ type: "text", text: "KEEP" });
  });

  test("anthropic: absent top-level system becomes the stanza", () => {
    const out = JSON.parse(
      injectedBodyOf(
        JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
        "STANZA",
        "messages",
      ),
    );
    expect(out.system).toBe("STANZA");
    expect(out.messages).toHaveLength(1); // messages UNTOUCHED — system is top-level
  });

  test("anthropic: string system MERGES (stanza first)", () => {
    const out = JSON.parse(
      injectedBodyOf(JSON.stringify({ system: "KEEP-ME", messages: [] }), "STANZA", "messages"),
    );
    expect(out.system).toBe("STANZA\n\nKEEP-ME");
  });

  test("anthropic: block-array system gains a leading text block", () => {
    const out = JSON.parse(
      injectedBodyOf(
        JSON.stringify({ system: [{ type: "text", text: "KEEP" }], messages: [] }),
        "STANZA",
        "messages",
      ),
    );
    expect(out.system[0]).toEqual({ type: "text", text: "STANZA" });
    expect(out.system[1]).toEqual({ type: "text", text: "KEEP" });
  });

  test("a non-chat-shaped body is returned UNTOUCHED (either dialect)", () => {
    const raw = JSON.stringify({ not: "a chat body" });
    expect(injectedBodyOf(raw, "STANZA", "chat")).toBe(raw);
    expect(injectedBodyOf(raw, "STANZA", "messages")).toBe(raw);
    expect(injectedBodyOf("not json at all", "STANZA", "chat")).toBe("not json at all");
  });

  test("openai: a non-leading system message rides untouched, stanza unshifts", () => {
    const out = JSON.parse(
      injectedBodyOf(
        JSON.stringify({
          messages: [
            { role: "user", content: "hi" },
            { role: "system", content: "late" },
          ],
        }),
        "STANZA",
        "chat",
      ),
    );
    expect(out.messages[0]).toEqual({ role: "system", content: "STANZA" });
    expect(out.messages[2]).toEqual({ role: "system", content: "late" });
  });
});

describe("EngineTelemetry (the litellm surface)", () => {
  const telemetryStub = (): { port: number; stop: () => void } => {
    const server = Bun.serve({
      port: 0,
      fetch: (req) => {
        const { pathname } = new URL(req.url);
        if (pathname === "/metrics")
          return new Response(
            '# TYPE engine_requests_total counter\nengine_requests_total{model="x"} 3\n# a comment line\nengine_up 1\n',
            { headers: { "content-type": "text/plain" } },
          );
        if (pathname === "/global/spend") return Response.json({ spend: 0.5, max_budget: 10 });
        if (pathname === "/global/spend/models")
          return Response.json({ data: [{ model: "x", total_spend: 0.5 }] });
        return new Response("not found", { status: 404 });
      },
    });
    return { port: server.port ?? 0, stop: () => server.stop(true) };
  };

  test("surfaces the engine's own prom scalars + spend (mem-cached window)", async () => {
    const { createEngineCollector } = await import("../metrics/buckle.metrics.engine.ts");
    const stub = telemetryStub();
    const settings = BuckleSettings.parse({
      hub: { label: "b1" },
      engine: { url: `http://127.0.0.1:${stub.port}` },
    });
    const engine = createEngineCollector(settings, () => null);
    const first = await engine.get();
    expect(first.reachable).toBe(true);
    expect(first.series['engine_requests_total{model="x"}']).toBe(3);
    expect(first.spend.total).toBe(0.5);
    expect(first.spend.by_model).toEqual([{ model: "x", spend: 0.5 }]);
    stub.stop();
  });

  test("a dead engine is reachable:false — honest, never a throw", async () => {
    const { createEngineCollector } = await import("../metrics/buckle.metrics.engine.ts");
    const settings = BuckleSettings.parse({
      hub: { label: "b1" },
      engine: { url: "http://127.0.0.1:1" },
    });
    const got = await createEngineCollector(settings, () => null).get();
    expect(got.reachable).toBe(false);
    expect(got.spend.total).toBeNull();
  });

  test("the window caches: one pull serves the window (mem-cached)", async () => {
    const { createWindowCache } = await import("../metrics/buckle.metrics.window.ts");
    let pulls = 0;
    const window = createWindowCache(60_000, async () => {
      pulls += 1;
      return pulls;
    });
    expect(await window.get()).toBe(1);
    expect(await window.get()).toBe(1);
    expect(pulls).toBe(1);
  });
});
