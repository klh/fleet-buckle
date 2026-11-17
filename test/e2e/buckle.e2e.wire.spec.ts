// buckle.e2e.wire.spec.ts — STEP 4: the REAL stack in Docker. Every
// unit serves /healthz, its provider's catalog (fetched from the stub,
// never declared), the MITM chat round trip through litellm → stub with
// the trace continued, and /metrics reflecting the traffic. Poll fns
// are TOTAL (throws become "connecting") — expect.poll does not catch.
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { BuckleModelsResponse } from "../../src/schemas/buckle.model.wire.zod.ts";
import { BuckleTreeResponse } from "../../src/schemas/buckle.tree.zod.ts";
import { BuckleStatsResponse } from "../../src/schemas/buckle.stats.zod.ts";

// the healthz face + the engine's chat echo — parsed, never hand-cast
const HealthzBody = z
  .object({
    ok: z.boolean().optional(),
    status: z.string().optional(),
    label: z.string().optional(),
  })
  .passthrough();
const ProviderCatalog = z.object({ data: z.array(z.object({ id: z.string() })) });
const MessagesEcho = z
  .object({
    content: z.array(z.object({ text: z.string().optional() }).passthrough()).optional(),
  })
  .passthrough();
const ChatEcho = z
  .object({
    id: z.string(),
    model: z.string().optional(),
    choices: z
      .array(
        z.object({ message: z.object({ content: z.string().optional() }).optional() }).optional(),
      )
      .optional(),
  })
  .passthrough();
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
  ProviderCatalog.parse(
    JSON.parse(readFileSync(join(ROOT, "test/deploy/fixtures", `${provider}.models.json`), "utf8")),
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
            const body = HealthzBody.parse(await r.json());
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
    const catalog = BuckleModelsResponse.parse(
      await (await fetch(`${unit.base}/v1/models`, { headers: AUTH })).json(),
    );
    expect(catalog.hub).toBe(unit.label);
    // carol's view FEDERATES: own ids always present (peers add rows)
    expect(catalog.models.map((m) => m.id).sort()).toEqual(
      expect.arrayContaining([...unit.catalogIds].sort()),
    );
    for (const m of catalog.models) {
      // own rows carry provider origin; federated rows (carol's view)
      // carry buckle origin with the PEER's label + url
      if (m.origin.kind === "provider") expect(m.origin.label).toBe(unit.provider);
    }

    // the MITM loop: chat → litellm engine → provider stub (echo).
    // Engines cold-start slowly after `up -d` — bounded warm-up poll
    // (total fn; throws are "connecting"), THEN one clean round trip.
    const inbound = "00-e2e1234567890abcdef1234567890abcdef-1234567890abcdef-01";
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
    const body = ChatEcho.parse(await chat.json());
    expect(body.id).toBe("stub-chat"); // engine passthrough, stub echo

    // CONTEXT INJECTION oracle — the stub answers from the body it
    // SAW: b2's policy stanza rides system-first ⇒ "injected";
    // policy-free units ride byte-identical ⇒ "plain" (the default
    // is NONE — inert unless a declared policy matches)
    const answer = body.choices?.[0]?.message?.content ?? "";
    expect(answer).toBe(unit.label === "b2" ? "injected" : "plain");

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
    const treeBody = BuckleTreeResponse.parse(await tree.json());
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
    // engine telemetry SURFACED (litellm's own /metrics + spend —
    // never re-counted): reachable with scalars banked; spend folds
    // honestly when the engine has no DB (nulls, never guesses)
    const statsBody = BuckleStatsResponse.parse(await stats.json());
    expect(statsBody.self.engine?.reachable).toBe(true);
    expect(statsBody.self.hub).toBe(unit.label);
    expect(
      statsBody.self.principals.find((p) => p.principal === "carol@fleet")?.requests ?? 0,
    ).toBeGreaterThanOrEqual(1);

    // engine telemetry — litellm's OWN counters, surfaced (never
    // re-counted). The prometheus multiproc dir banks asynchronously
    // after the rode traffic, so the series appear EVENTUALLY: a
    // bounded total poll on the stats face (reachable now, series
    // within seconds)
    await expect
      .poll(
        async () => {
          try {
            const body = BuckleStatsResponse.parse(
              await (await fetch(`${unit.base}/v1/stats`, { headers: AUTH })).json(),
            );
            return Object.keys(body.self.engine?.series ?? {}).length;
          } catch {
            return -1;
          }
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

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

// ── the second wave: dialects, launch lanes, pass-through ────────
// b2 is the carrying unit (policy + lanes table); the stub oracles
// answer from the body they SAW (CONTEXT-MARK / model echo)
test.describe("b2: injection dialects + /w/ lanes + pass-through", () => {
  const B2 = "http://127.0.0.1:4721";
  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(`${B2}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...AUTH },
      body: JSON.stringify(body),
    });

  test("POST /v1/messages (anthropic dialect) injects the TOP-LEVEL system", async () => {
    const r = await post("/v1/messages", {
      model: "gpt-6-astra",
      max_tokens: 64,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.status).toBe(200);
    const body = MessagesEcho.parse(await r.json());
    expect(body.content?.[0]?.text).toBe("injected"); // the mark rode system-first
    expect(r.headers.get("x-fleet-buckle-context-rule")).toBe("b2-baseline");
  });

  test("the /w/review-lane launch URL fires the LANE rule (first-match wins)", async () => {
    const r = await post("/w/review-lane/v1/chat/completions", {
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.status).toBe(200);
    const body = ChatEcho.parse(await r.json());
    expect(body.choices?.[0]?.message?.content).toBe("injected");
    expect(r.headers.get("x-fleet-buckle-context-rule")).toBe("lane-review");
    // never-silent: the counter carries the rule id
    await expect
      .poll(
        async () =>
          (await (await fetch(`${B2}/metrics`)).text()).includes(
            'buckle_context_injections_total{buckle="b2",rule="lane-review"}',
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
  });

  test("the /w/pin-haiku lane PIN wins over the body model", async () => {
    const r = await post("/w/pin-haiku/v1/chat/completions", {
      model: "gpt-6-astra", // the body asks astra…
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.status).toBe(200);
    const body = ChatEcho.parse(await r.json());
    expect(body.model).toBe("claude-haiku-5.5"); // …the PIN rode
    expect(r.headers.get("x-buckle-route")).toBe("pin-haiku");
  });

  test("a slug with NO row is pure attribution — rides unpinned, echo named", async () => {
    const r = await post("/w/any-lane-name/v1/chat/completions", {
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.status).toBe(200);
    const body = ChatEcho.parse(await r.json());
    expect(body.model).toBe("gpt-6-astra"); // no pin — body model rode
    expect(r.headers.get("x-buckle-route")).toBe("any-lane-name");
    expect(r.headers.get("x-fleet-buckle-context-rule")).toBe("b2-baseline");
  });

  test("unhandled faces pass through to the ENGINE verbatim", async () => {
    // a real litellm face, reached THROUGH the buckle gate (auth
    // consumed at the gate; the engine token rides)
    const live = await fetch(`${B2}/health/liveliness`, { headers: AUTH });
    expect(live.status).toBe(200);
    expect(JSON.parse(await live.text())).toBe("I'm alive!");
    // the engine's own verdict relays byte-identical — an unknown
    // path answers with LITELLM'S 404, not a buckle one
    const unknown = await fetch(`${B2}/v1/no/such/face`, {
      method: "POST",
      headers: { "content-type": "application/json", ...AUTH },
      body: "{}",
    });
    expect(unknown.status).toBe(404);
    const body = z
      .object({ detail: z.string().optional() })
      .passthrough()
      .parse(await unknown.json());
    expect(body.detail).toBe("Not Found");
  });

  test("the catch-all refuses anonymous and un-granted callers (regression: engine-key swap)", async () => {
    // anonymous: NO credential — the engine key must NEVER ride for
    // an anonymous caller (the pre-fix bug: admitPrincipal(null) →
    // admitted, passthrough swapped in the engine key)
    const anon = await fetch(`${B2}/v1/keys`);
    expect(anon.status).toBe(401);
    expect(anon.headers.get("content-type")).toContain("application/problem+json");
    // the anonymous refusal NEVER reached the provider stub
    const seenBody = JSON.parse(await (await fetch(`http://127.0.0.1:4742/_seen`)).text());
    const seenAnon = z.object({ seen: z.array(z.object({ face: z.string() })) }).parse(seenBody);
    expect(seenAnon.seen.some((r) => r.face.includes("/v1/keys"))).toBe(false);
  });
});
