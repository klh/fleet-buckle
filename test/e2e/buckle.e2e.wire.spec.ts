// buckle.e2e.wire.spec.ts — STEP 4: the REAL stack in Docker. Every
// unit serves /healthz, its provider's catalog (fetched from the stub,
// never declared), the MITM chat round trip through litellm → stub with
// the trace continued, and /metrics reflecting the traffic. Poll fns
// are TOTAL (throws become "connecting") — expect.poll does not catch.
import { expect, test } from "@playwright/test";

const UNITS = [
  {
    label: "b1",
    base: "http://127.0.0.1:4711",
    provider: "openrouter",
    chatModel: "openai/qwen3-coder",
    catalogIds: ["openai/qwen3-coder", "openai/qwen3-235b"],
  },
  {
    label: "b2",
    base: "http://127.0.0.1:4721",
    provider: "mscopilot",
    chatModel: "openai/gpt-6-astra",
    catalogIds: ["openai/gpt-6-astra"],
  },
  {
    label: "b3",
    base: "http://127.0.0.1:4731",
    provider: "zai",
    chatModel: "openai/glm-5.3",
    catalogIds: ["openai/glm-5.3", "openai/glm-5.3-air"],
  },
] as const;

for (const unit of UNITS) {
  test(`STEP 4 — ${unit.label}: healthz, catalog, MITM round trip, metrics`, async () => {
    // healthz — the honest up
    await expect
      .poll(
        async () => {
          try {
            const r = await fetch(`${unit.base}/healthz`);
            if (r.status !== 200) return "bad-status";
            const body = (await r.json()) as { ok?: boolean; status?: string; label?: string };
            return body.ok === true && body.status === "up" && body.label === unit.label
              ? "up"
              : "wrong-body";
          } catch {
            return "connecting";
          }
        },
        { timeout: 30_000 },
      )
      .toBe("up");

    // catalog — fetched from the provider stub, hub label ours
    const catalog = (await (
      await fetch(`${unit.base}/v1/models`)
    ).json()) as {
      hub: string;
      models: { id: string; origin: { kind: string; label: string } }[];
    };
    expect(catalog.hub).toBe(unit.label);
    expect(catalog.models.map((m) => m.id).sort()).toEqual(
      [...unit.catalogIds].sort(),
    );
    for (const m of catalog.models) {
      expect(m.origin.kind).toBe("provider");
      expect(m.origin.label).toBe(unit.provider);
    }

    // the MITM loop: chat → litellm engine → provider stub (echo).
    // Engines cold-start slowly after `up -d` — bounded warm-up poll
    // (total fn; throws are "connecting"), THEN one clean round trip.
    const inbound =
      "00-e2e1234567890abcdef1234567890abcdef-1234567890abcdef-01";
    const postChat = (): Promise<Response> =>
      fetch(`${unit.base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", traceparent: inbound },
        body: JSON.stringify({
          model: unit.chatModel,
          messages: [{ role: "user", content: `hello from ${unit.label} e2e` }],
        }),
      });
    await expect
      .poll(
        async () => {
          try {
            return (await postChat()).status;
          } catch {
            return "connecting";
          }
        },
        { timeout: 90_000 },
      )
      .toBe(200);
    const chat = await postChat();
    expect(chat.status).toBe(200);
    const body = (await chat.json()) as { id: string; choices?: { message?: { content?: string } }[] };
    expect(body.id).toBe("stub-chat"); // engine passthrough, stub echo

    // unknown model fails LOUD (problem+json, never the engine's 404)
    const unknown = await fetch(`${unit.base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "nope/nothing", messages: [] }),
    });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toContain("problem+json");

    // metrics — the traffic landed in the Prometheus face (warm-up
    // polls may have bumped the counter; assert the line with a
    // NONZERO count, not an exact one)
    const metrics = await (await fetch(`${unit.base}/metrics`)).text();
    expect(metrics).toMatch(
      new RegExp(
        `buckle_requests_total\{buckle="${unit.label}",model="${unit.chatModel.replace("/", "\\/")}"\} [1-9]\d*`,
      ),
    );
  });
}
