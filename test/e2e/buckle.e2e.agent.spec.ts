// buckle.e2e.agent.spec.ts — the DURABLE WORKER cycle, hermetic and
// whole: the gh-stub is the repo (its control face files the work),
// the signed webhook is the wake seam, the worker rides the b3
// /w/<lane> launch URL (the lane row PINS its model), the zai stub
// answers the three agent contracts, and the PR lands back on the
// stub. EVERY assertion derives from evidence the oracles SAW —
// gh-stub /_state and zai-stub /_seen, keyed to THIS run's issue
// number and timestamp — never hand-typed ids.
//
// The PIN-PROOF: the worker's body model (glm-4.5, worker.model.ts)
// deliberately DIFFERS from the lane pin (glm-4.5-air, the b3
// settings lane row) — so a seen model of glm-4.5-air proves the pin
// won, and any record carrying bare glm-4.5 proves it did not.
// Poll fns are TOTAL (throws become "connecting") — expect.poll
// does not catch.
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { PORTS } from "../kit/buckle.kit.stack.ts";

// topology constants (b3.settings.json5 lanes row / worker.model.ts):
// the pin must win over the body model on EVERY ask
const LANE_PIN = "glm-4.5-air";
const BODY_MODEL = "glm-4.5";
const LANE_RULE_HEAD = "You are the calculon repo worker";
const ISSUE_PREFIX = "[agent]";

// what the oracles serve — parsed, never hand-cast
const GhState = z.object({
  issues: z.array(z.object({ number: z.number(), title: z.string() })),
  comments: z.record(
    z.string(),
    z.array(
      z.object({
        id: z.number(),
        body: z.string(),
        user: z.object({ login: z.string() }),
      }),
    ),
  ),
  branches: z.array(z.object({ ref: z.string(), sha: z.string() })),
  files: z.array(z.object({ path: z.string(), branch: z.string(), contentB64: z.string() })),
  pulls: z.array(
    z.object({ number: z.number(), head: z.string(), base: z.string(), title: z.string() }),
  ),
  webhooks: z.array(
    z.object({
      at: z.number(),
      event: z.string(),
      action: z.string(),
      issue: z.number(),
      status: z.number().or(z.string()),
    }),
  ),
});
type GhState = z.infer<typeof GhState>;

const SeenRing = z.object({
  seen: z.array(
    z.object({
      at: z.number(),
      face: z.string(),
      model: z.string(),
      systemMark: z.boolean(),
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

const postIssue = async (title: string, body: string): Promise<number> => {
  const r = await fetch(`http://127.0.0.1:${PORTS.ghStub}/repos/icomdev/calculon/issues`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, body }),
  });
  const issue = z.object({ number: z.number() }).parse(await r.json());
  return issue.number;
};

const postComment = async (n: number, body: string): Promise<void> => {
  const r = await fetch(
    `http://127.0.0.1:${PORTS.ghStub}/repos/icomdev/calculon/issues/${n}/comments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
  expect(r.status).toBe(201);
};

test.describe.serial("the durable worker cycle (hermetic, whole)", () => {
  test("issue → wake → clarify → accept → plan → PR, all from evidence", async () => {
    test.setTimeout(300_000);

    // ── file the work (the control face is the writer; the webhook
    //    is the worker's wake) ──
    const t0 = Date.now();
    const marker = `spec-${t0}`;
    const n = await postIssue(
      `${ISSUE_PREFIX} e2e marker ${marker}`,
      `Add a marker page under docs for run ${marker} so the durable worker cycle is visible.`,
    );

    // ── sweep 1: the worker wakes, classifies, asks its pin-down
    //    questions (wake latency or one poll backstop) ──
    await expect
      .poll(
        async () =>
          (await ghState()).comments[String(n)]?.some(
            (c) => c.user.login === "fleet-worker[bot]" && c.body.includes("pin down"),
          ) ?? false,
        { timeout: 120_000 },
      )
      .toBe(true);

    // ── evidence: the pin won and the lane rule rode system-first.
    //    Contract-bearing records are EXACTLY the worker's asks (wire
    //    tests ride the same stub with plain prompts — excluded), so
    //    the cycle is identifiable without hand-typed ids ──
    const afterClarify = (await seenRing()).seen.filter((r) => r.at >= t0 && r.contract !== null);
    expect(afterClarify).toHaveLength(2);
    for (const r of afterClarify) {
      expect(r.model).toBe(LANE_PIN); // the pin, never the body model
      expect(r.system).toContain(LANE_RULE_HEAD); // injection visible
    }
    expect(afterClarify.filter((r) => r.contract === "classify")).toHaveLength(1);
    expect(afterClarify.filter((r) => r.contract === "questions")).toHaveLength(1);

    // ── the writer accepts ──
    await postComment(n, `Title: ${marker}. Link back: yes. accepted — go ahead.`);

    // ── sweep 2: plan → branch → file → PR → done-comment ──
    await expect
      .poll(
        async () => {
          const s = await ghState();
          return (
            s.pulls.some((p) => p.head === `agent/issue-${n}` && p.base === "main") &&
            s.files.some(
              (f) => f.path === `docs/agent-e2e-${n}.md` && f.branch === `agent/issue-${n}`,
            )
          );
        },
        { timeout: 120_000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () =>
          (await ghState()).comments[String(n)]?.some(
            (c) => c.user.login === "fleet-worker[bot]" && c.body.includes("Done — PR"),
          ) ?? false,
        { timeout: 30_000 },
      )
      .toBe(true);

    // ── evidence: the implement contract, still pinned, still
    //    injected — and SINGLE-LANE: exactly three asks for this
    //    cycle, no fan-out, no retry storm ──
    const cycle = (await seenRing()).seen.filter((r) => r.at >= t0 && r.contract !== null);
    expect(cycle.map((r) => r.contract)).toEqual(["classify", "questions", "implement"]);
    for (const r of cycle) {
      expect(r.model).toBe(LANE_PIN);
      expect(r.model).not.toBe(BODY_MODEL);
      expect(r.system).toContain(LANE_RULE_HEAD);
    }

    // ── the wake seam delivered BOTH events, signed and accepted ──
    const hooks = (await ghState()).webhooks.filter((w) => w.issue === n);
    expect(hooks).toEqual([
      expect.objectContaining({ event: "issues", action: "opened", status: 200 }),
      expect.objectContaining({ event: "issue_comment", action: "created", status: 200 }),
    ]);

    // ── the branch cut from main's ref (fixture sha, not hand-typed) ──
    const s = await ghState();
    expect(s.branches.find((b) => b.ref === `refs/heads/agent/issue-${n}`)?.sha).toBe(
      "a".repeat(40),
    );
  });
});
