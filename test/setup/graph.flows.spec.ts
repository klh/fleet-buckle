// The integrated flows, run after bounded readiness against the hermetic
// stack: model identity, deny cases, trace join. Stream and retry proofs
// need stub support and are tracked fixmes (not silently passing).
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
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
const ask = { model: "qwen/qwen3.8-max-prime", messages: [{ role: "user", content: "graph" }] };

test.describe.serial("graph flows", () => {
  test("model identity: the served model echoes the requested id", async () => {
    await expect
      .poll(async () => (await chat({ authorization: `Bearer ${keyOf()}` }, ask)).status, {
        timeout: 90_000,
      })
      .toBe(200);
    const body = (await (await chat({ authorization: `Bearer ${keyOf()}` }, ask)).json()) as {
      model?: string;
    };
    expect(body.model).toBe(ask.model);
  });

  test("deny cases: anonymous 401, unknown model 404 problem+json", async () => {
    expect((await chat({}, ask)).status).toBe(401);
    const r = await chat({ authorization: `Bearer ${keyOf()}` }, { ...ask, model: "nope/nothing" });
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toContain("problem+json");
  });

  test("trace join: inbound traceparent id is found in Jaeger", async () => {
    const traceId = "9a".repeat(16);
    const r = await chat(
      { authorization: `Bearer ${keyOf()}`, traceparent: `00-${traceId}-1234567890abcdef-01` },
      ask,
    );
    expect(r.status).toBe(200);
    await expect
      .poll(
        async () => {
          const j = await fetch(`http://127.0.0.1:${PORTS.jaeger}/api/traces/${traceId}`);
          return j.status;
        },
        { timeout: 30_000 },
      )
      .toBe(200);
  });

  test.fixme("streams: SSE passthrough (needs stub stream mode)", () => {});
  test.fixme("retries: bounded retry/429 Retry-After (needs stub fault mode)", () => {});
});
