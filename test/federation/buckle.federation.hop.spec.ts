// buckle.federation.hop.spec.ts — COMMIT 6: the federation HOP through
// the REAL Docker stack. The proof of the per-hop grant edges: bob's
// zai chat rides b1→b3 (serving chain "b1,b3"), carol's rides b2→b3,
// and a peer outside a grant is indistinguishable from an unknown
// model (404, no leak). Catalog expectations DERIVE from the fixture
// stores — glm-5.3 is zai-ONLY, gpt-6-astra is mscopilot-only (asserted
// by the e2e matrix), so the hop edges are fixture-proof too.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const keyOf = (principal: string): string =>
  readFileSync(join(ROOT, `test/deploy/keys/.gen/principal.${principal}.key`), "utf8").trim();

const B1 = "http://127.0.0.1:4711";
const B2 = "http://127.0.0.1:4721";
const B3 = "http://127.0.0.1:4731";

const chat = (base: string, key: string, model: string) =>
  fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hop" }] }),
  });

/** requests_total for a model at a unit (0 when absent) */
async function requestCount(base: string, model: string): Promise<number> {
  const text = await (await fetch(`${base}/metrics`)).text();
  const m = text.match(
    new RegExp(`buckle_requests_total\\{buckle="[^"]+",model="${model}"\\} (\\d+)`),
  );
  return m === null ? 0 : Number(m[1]);
}

test.beforeAll(async () => {
  // the stack rides the smoke project (dependency); wait for the head
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${B1}/healthz`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(200);
});

test("bob@b1: zai chat HOPS b1→b3 — chain, body, BOTH hubs count it", async () => {
  const before1 = await requestCount(B1, "glm-5.3");
  const before3 = await requestCount(B3, "glm-5.3");
  const r = await chat(B1, keyOf("bob@fleet"), "glm-5.3");
  expect(r.status).toBe(200);
  expect(r.headers.get("x-fleet-buckle-served-by")).toBe("b1,b3");
  const body = (await r.json()) as { id: string; usage?: { total_tokens: number } };
  expect(body.id).toBe("stub-chat"); // b3's engine → zai stub served it
  expect(body.usage?.total_tokens).toBeGreaterThan(0);
  // the head AND the serving peer each count the model they served
  expect(await requestCount(B1, "glm-5.3")).toBeGreaterThan(before1);
  expect(await requestCount(B3, "glm-5.3")).toBeGreaterThan(before3);
});

test("carol@b2: zai chat HOPS b2→b3 (every-peer grant)", async () => {
  const r = await chat(B2, keyOf("carol@fleet"), "glm-5.3");
  expect(r.status).toBe(200);
  expect(r.headers.get("x-fleet-buckle-served-by")).toBe("b2,b3");
  expect(((await r.json()) as { id: string }).id).toBe("stub-chat");
});

test("bob@b3 directly: the SAME model is a LOCAL engine path (chain 'b3')", async () => {
  const r = await chat(B3, keyOf("bob@fleet"), "glm-5.3");
  expect(r.status).toBe(200);
  expect(r.headers.get("x-fleet-buckle-served-by")).toBe("b3");
});

test("bob@b1: mscopilot model (peer NOT granted) is indistinguishable from unknown — 404", async () => {
  const r = await chat(B1, keyOf("bob@fleet"), "gpt-6-astra");
  expect(r.status).toBe(404);
  expect(r.headers.get("content-type")).toContain("application/problem+json");
  const problem = (await r.json()) as { kind: string };
  expect(problem.kind).toBe("not-found");
  // it exists on b2 — but bob asked b1, where his view excludes b2
  expect((await chat(B2, keyOf("carol@fleet"), "gpt-6-astra")).status).toBe(200);
});

test("alice@b1 (peers []): even a REAL peer model is 404 — own-only view", async () => {
  const r = await chat(B1, keyOf("alice@fleet"), "glm-5.3");
  expect(r.status).toBe(404);
  const problem = (await r.json()) as { kind: string };
  expect(problem.kind).toBe("not-found");
});
