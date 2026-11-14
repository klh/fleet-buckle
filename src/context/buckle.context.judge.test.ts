// buckle.context.judge.test.ts — the decision seam's contract: the
// DEFAULT is inert (true — the chain rides verbatim), facts carry
// what judging needs (who, body start, model), rules match with AND
// semantics, first match wins, and file stanzas resolve ONCE at
// build. The engine telemetry collector rides here too: litellm's
// own /metrics + spend endpoints surfaced on one mem-cache window.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ContextFacts, inertJudge, judgeOf } from "./buckle.context.judge.ts";
import {
  BuckleContextPolicy,
  BuckleSettings,
} from "../schemas/buckle.settings.zod.ts";

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

  test("a rule with no dimensions matches everything; first match wins", () => {
    const judge = judgeOf(
      BuckleContextPolicy.parse({ inject: [{ text: "FIRST" }, { text: "SECOND" }] }),
    );
    expect(judge(factsOf())).toEqual({ system: "FIRST" });
  });

  test("dimensions match with AND semantics — a miss on any is inert", () => {
    const judge = judgeOf(
      BuckleContextPolicy.parse({
        inject: [{ principal: "carol", models: ["gpt-6-astra"], bodyContains: "hello", text: "STANZA" }],
      }),
    );
    expect(judge(factsOf())).toEqual({ system: "STANZA" });
    expect(judge(factsOf({ principal: "dana" }))).toBe(true);
    expect(judge(factsOf({ model: "other-model" }))).toBe(true);
    expect(judge(factsOf({ bodyStart: "no greeting here" }))).toBe(true);
  });

  test("model matching is exact OR prefix (group ids)", () => {
    const judge = judgeOf(BuckleContextPolicy.parse({ inject: [{ models: ["gpt"], text: "S" }] }));
    expect(judge(factsOf({ model: "gpt-6" }))).toEqual({ system: "S" });
    expect(judge(factsOf({ model: "gpt" }))).toEqual({ system: "S" });
    expect(judge(factsOf({ model: "qwen/x" }))).toBe(true);
  });

  test("a file stanza is read ONCE at build (boot custody, not on-path)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ctx-"));
    const file = join(dir, "stanza.md");
    writeFileSync(file, "CONTEXT-MARK from file");
    const judge = judgeOf(BuckleContextPolicy.parse({ inject: [{ file }] }));
    expect(judge(factsOf())).toEqual({ system: "CONTEXT-MARK from file" });
  });

  test("facts carry the judging info and reject drift", () => {
    expect(() => ContextFacts.parse({ route: "chat", principal: "" })).toThrow();
    expect(
      ContextFacts.parse({ route: "chat", principal: "c", model: "m", bodyStart: "b", repo: "klh/fleet" }).repo,
    ).toBe("klh/fleet");
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
            "# TYPE engine_requests_total counter\nengine_requests_total{model=\"x\"} 3\n# a comment line\nengine_up 1\n",
            { headers: { "content-type": "text/plain" } },
          );
        if (pathname === "/global/spend")
          return Response.json({ spend: 0.5, max_budget: 10 });
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
