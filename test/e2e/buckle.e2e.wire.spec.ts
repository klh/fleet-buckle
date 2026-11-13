// buckle.e2e.wire.spec.ts — STEP 4: the REAL stack in Docker. Every
// unit serves /healthz, its provider's catalog (fetched from the stub,
// never declared), the MITM chat round trip through litellm → stub with
// the trace continued, and /metrics reflecting the traffic. Poll fns
// are TOTAL (throws become "connecting") — expect.poll does not catch.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// carol holds every scope on every buckle of the demo topology; her key
// is MINTED (0600, gitignored) by globalSetup before the stack boots
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CAROL_KEY = readFileSync(
  join(ROOT, "test/deploy/keys/.gen/principal.carol@fleet.key"),
  "utf8",
).trim();
const AUTH = { authorization: `Bearer ${CAROL_KEY}` };

// catalog expectations DERIVE from the fixture stores — the same real
// captured files the stubs serve, so a fixture refresh never needs a
// spec edit (single source of truth)
const fixtureIds = (provider: string): string[] =>
  (
    JSON.parse(
      readFileSync(join(ROOT, "test/deploy/fixtures", `${provider}.models.json`), "utf8"),
    ) as { data: { id: string }[] }
  ).data.map((m) => m.id);

const UNITS = [
  {
    label: "b1",
    base: "http://127.0.0.1:4711",
    provider: "openrouter",
    chatModel: "qwen/qwen3.8-max-prime",
    catalogIds: fixtureIds("openrouter"),
  },
  {
    label: "b2",
    base: "http://127.0.0.1:4721",
    provider: "mscopilot",
    chatModel: "gpt-6-astra",
    catalogIds: fixtureIds("mscopilot"),
  },
  {
    label: "b3",
    base: "http://127.0.0.1:4731",
    provider: "zai",
    chatModel: "glm-5.3",
    catalogIds: fixtureIds("zai"),
  },
];

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
      await fetch(`${unit.base}/v1/models`, { headers: AUTH })
    ).json()) as {
      hub: string;
      models: { id: string; origin: { kind: string; label: string } }[];
    };
    expect(catalog.hub).toBe(unit.label);
    // carol's view FEDERATES: own ids always present (peers add rows)
    expect(catalog.models.map((m) => m.id).sort()).toEqual(
      expect.arrayContaining([...unit.catalogIds].sort()),
    );
    for (const m of catalog.models) {
      // own rows carry provider origin; federated rows (carol's view)
      // carry buckle origin with the PEER's label + url
      if (m.origin.kind === "provider")
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
        headers: { "content-type": "application/json", traceparent: inbound, ...AUTH },
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
      headers: { "content-type": "application/json", ...AUTH },
      body: JSON.stringify({ model: "nope/nothing", messages: [] }),
    });
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("content-type")).toContain("problem+json");

    // the federated tree — b1's view carries its peers (and b2's own
    // peer b3 as a SUMMARY); b2 carries b3; b3 carries nobody
    const tree = await fetch(`${unit.base}/v1/tree`, { headers: AUTH });
    expect(tree.status).toBe(200);
    const treeBody = (await tree.json()) as {
      self: { buckle: { label: string }; peers: { buckle: { label: string }; models: unknown[]; peers: { buckle: { label: string } }[] }[] };
    };
    expect(treeBody.self.buckle.label).toBe(unit.label);
    const peerLabels = treeBody.self.peers.map((p) => p.buckle.label).sort();
    if (unit.label === "b1") expect(peerLabels).toEqual(["b2", "b3"]);
    if (unit.label === "b2") expect(peerLabels).toEqual(["b3"]);
    if (unit.label === "b3") expect(peerLabels).toEqual([]);
    if (unit.label === "b1") {
      const b2Node = treeBody.self.peers.find((p) => p.buckle.label === "b2")!;
      expect(b2Node.peers.map((p) => p.buckle.label)).toEqual(["b3"]); // summary
      expect(b2Node.models.length).toBeGreaterThan(0); // pulled, not empty
    }

    // live stats — grant-gated overview reflects the chatted traffic
    const stats = await fetch(`${unit.base}/v1/stats`, { headers: AUTH });
    expect(stats.status).toBe(200);
    const statsBody = (await stats.json()) as { self: { hub: string; principals: { principal: string; requests: number }[] } };
    expect(statsBody.self.hub).toBe(unit.label);
    expect(
      statsBody.self.principals.find((p) => p.principal === "carol@fleet")
        ?.requests ?? 0,
    ).toBeGreaterThanOrEqual(1);

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
