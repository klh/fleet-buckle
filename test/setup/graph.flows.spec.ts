// The integrated flows, run after bounded readiness against the hermetic
// stack: model identity, deny cases, trace join. Stream and retry proofs
// stream (SSE) and bounded retry ride the stub's stream / 429 fault modes.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { BuckleCorrelation } from "../../src/schemas/buckle.stats.zod.ts";
import { PORTS } from "../kit/buckle.kit.stack.ts";

// lazy: keys are minted by stack-setup, absent at --list time
const keyOf = (): string =>
  readFileSync(
    new URL("../deploy/keys/.gen/principal.carol@fleet.key", import.meta.url),
    "utf8",
  ).trim();
const B1 = `http://127.0.0.1:${PORTS.b1}`;
const chat = (headers: Record<string, string>, body: object): Promise<Response> =>
  fetch(`${B1}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const JaegerBody = z.object({
  data: z.array(z.object({ traceID: z.string(), spans: z.array(z.object({ traceID: z.string(), spanID: z.string() })) })),
});
const ask = { model: "qwen/qwen3.8-max-prime", messages: [{ role: "user", content: "graph" }] };

test.describe.serial("graph flows", () => {
  test("model identity: the served model echoes the requested id", async () => {
    await expect
      .poll(async () => (await chat({ authorization: `Bearer ${keyOf()}` }, ask)).status, {
        timeout: 90_000,
      })
      .toBe(200);
    const body = z
      .object({ model: z.string().optional() })
      .parse(await (await chat({ authorization: `Bearer ${keyOf()}` }, ask)).json());
    expect(body.model).toBe(ask.model);
  });

  test("deny cases: anonymous 401, unknown model 404 problem+json", async () => {
    expect((await chat({}, ask)).status).toBe(401);
    const r = await chat({ authorization: `Bearer ${keyOf()}` }, { ...ask, model: "nope/nothing" });
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toContain("problem+json");
  });

  test("trace join: traceparent reaches Jaeger and W14 correlation fields join", async () => {
    // the W14 correlation row (B06 fixture) must satisfy the schema, and
    // its traceparent's trace id is the join key the gateway must carry
    const fixture = z
      .object({ rows: z.array(z.object({ correlation: z.unknown() })) })
      .parse(
        JSON.parse(
          readFileSync(new URL("../../src/schemas/fixtures/read-model.v1.json", import.meta.url), "utf8"),
        ),
      );
    const corr = BuckleCorrelation.parse(fixture.rows[0]?.correlation);
    const traceId = corr.traceparent.split("-")[1] as string;
    let r: Response | undefined;
    await expect
      .poll(async () => {
        r = await chat(
          {
            authorization: `Bearer ${keyOf()}`,
            traceparent: corr.traceparent,
            "x-request-id": corr.request_id,
          },
          ask,
        );
        return r.status;
      }, { timeout: 90_000 })
      .toBe(200);
    if (!r) throw new Error("trace-join chat did not complete");
    let spans: { traceID: string; spans: { traceID: string; spanID: string }[] } | undefined;
    await expect
      .poll(
        async () => {
          const j = await fetch(`http://127.0.0.1:${PORTS.jaeger}/api/traces/${traceId}`);
          if (j.status !== 200) return 0;
          spans = JaegerBody.parse(await j.json()).data[0];
          return spans?.spans.length ?? 0;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    if (spans === undefined) {
      const all = await fetch(`http://127.0.0.1:${PORTS.jaeger}/api/traces?limit=10`);
      const dump = { jaegerStatus: all.status, jaegerBody: (await all.text()).slice(0, 500), resTraceparent: r.headers?.get("traceparent"), resRequestId: r.headers?.get("x-request-id"), jaegerPort: PORTS.jaeger, b1Port: PORTS.b1 };
      const { writeFileSync } = await import("node:fs");
      writeFileSync("/tmp/trace-debug.json", JSON.stringify(dump, null, 1));
    }
    expect(spans?.traceID).toBe(traceId);
    // every exported span of the join carries the W14 trace id
    for (const sp of spans?.spans ?? []) expect(sp.traceID).toBe(traceId);
  });

  test("streams: SSE passthrough ends with [DONE]", async () => {
    const r = await chat({ authorization: `Bearer ${keyOf()}` }, { ...ask, stream: true });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    const text = await r.text();
    expect(text).toContain("data: ");
    expect(text).toContain("[DONE]");
  });

  test("retries: a stub 429 + Retry-After is bounded (relayed or retried to success)", async () => {
    const key = `g${Date.now()}`;
    const body = { ...ask, messages: [{ role: "user", content: `STUB-FAULT-429:${key}` }] };
    const first = await chat({ authorization: `Bearer ${keyOf()}` }, body);
    if (first.status === 429) {
      expect(first.headers.get("retry-after")).not.toBeNull();
      const again = await chat({ authorization: `Bearer ${keyOf()}` }, body);
      expect(again.status).toBe(200);
    } else expect(first.status).toBe(200);
  });
});
