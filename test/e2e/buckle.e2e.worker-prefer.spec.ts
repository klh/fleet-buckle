// buckle.e2e.worker-prefer.spec.ts — the PICKER seam only. The full
// issue→PR cycle, wake, and gh contracts are the agent spec's beat
// (and the pi-durable seed image's); what is NEW here is: the .prefer
// file drives a boot-time pick (hub LABEL via hubs.json, prefer=
// ladder — never must= — uppercase token → catalog casing on
// the wire), the asks ride the DIRECT engine path (no lane pin, no
// lane context injection), and the long-running cycle still LANDS.
// Evidence only from what the oracles SAW, keyed to this run.
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { PORTS } from "../kit/buckle.kit.stack.ts";

const PICKED_MODEL = "glm-4.6"; // catalog casing; the file says GLM-4.6
const LANE_RULE_HEAD = "You are the calculon repo worker";

const GhState = z.object({
  comments: z.record(
    z.string(),
    z.array(z.object({ body: z.string(), user: z.object({ login: z.string() }) })),
  ),
  pulls: z.array(z.object({ head: z.string(), base: z.string() })),
});
type GhState = z.infer<typeof GhState>;

const SeenRing = z.object({
  seen: z.array(
    z.object({
      at: z.number(),
      model: z.string(),
      system: z.string().nullable(),
      contract: z.string().nullable(),
    }),
  ),
});
type SeenRing = z.infer<typeof SeenRing>;

const ghState = async (): Promise<GhState> =>
  GhState.parse(await (await fetch(`http://127.0.0.1:${PORTS.ghStub}/_state`)).json());
const seenRing = async (): Promise<SeenRing> =>
  SeenRing.parse(await (await fetch(`http://127.0.0.1:${PORTS.zaiSeen}/_seen`)).json());
// cycle asks = rows the stub classified (classify/questions/implement
// detectors). system is NULL on the direct path — the persona rides
// the user content, and a lane pin would inject a system field — so
// the unpinned proof is null-safe containment, not exclusion. Boot
// probes classify as "implement" too; they carry the same picked
// model and no system, so they are harmless witnesses.
const cycleAsks = async (t0: number) =>
  (await seenRing()).seen.filter((r) => r.at >= t0 && r.contract !== null);

test("prefer file → self-picked model serves the cycle unpinned, and the work lands", async () => {
  test.setTimeout(300_000);

  const t0 = Date.now();
  const issueR = await fetch(`http://127.0.0.1:${PORTS.ghStub}/repos/icomdev/calculon/issues`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `[picker] seam proof ${t0}`,
      body: `Add a marker page under docs for run ${t0} (picker seam proof).`,
    }),
  });
  const n = z.object({ number: z.number() }).parse(await issueR.json()).number;

  // the cycle advances under the picked model (poll backstop; no wake)
  await expect
    .poll(
      async () =>
        (await ghState()).comments[String(n)]?.some(
          (c) => c.user.login === "fleet-worker[bot]" && c.body.includes("pin down"),
        ) ?? false,
      { timeout: 120_000 },
    )
    .toBe(true);

  // the seam: catalog casing on the wire, direct path (no lane rule)
  const asks = await cycleAsks(t0);
  expect(asks.length).toBeGreaterThanOrEqual(2);
  for (const r of asks) {
    expect(r.model).toBe(PICKED_MODEL);
    expect(r.system ?? "").not.toContain(LANE_RULE_HEAD); // null = no injection at all
  }

  // accept → the long-running leg still lands (PR on the stub)
  const accR = await fetch(
    `http://127.0.0.1:${PORTS.ghStub}/repos/icomdev/calculon/issues/${n}/comments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: `Title: picker ${t0}. Link back: yes. accepted — go ahead.` }),
    },
  );
  expect(accR.status).toBe(201);

  await expect
    .poll(
      async () =>
        (await ghState()).pulls.some((p) => p.head === `agent/issue-${n}` && p.base === "main"),
      { timeout: 120_000 },
    )
    .toBe(true);

  // still the picked model, still unpinned, through the whole cycle
  for (const r of await cycleAsks(t0)) {
    expect(r.model).toBe(PICKED_MODEL);
    expect(r.system ?? "").not.toContain(LANE_RULE_HEAD); // null = no injection at all
  }
});
