// smoke — STAGE 0, the first smoke test, now a standing demo: compose
// the stack with the stubs, the three buckles, and the sidecars — no
// engines yet. The minimal buckle ANSWERS (healthz), so the sidecars
// swear all three up — the smoke test that should not fail works. And
// the one that should fail fails: a chat round trip is honestly red
// (no engine behind these buckles), proven with test.fail.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { HealthFace, HealthVerdict } from "@fleet/health";
import { BuckleHealthz } from "../../src/schemas/buckle.healthz.zod.ts";

const PROJECT = "fleet-buckle-stage0";
const ROOT = new URL("../..", import.meta.url).pathname;
let carol = "";

const FILE = "deploy/compose.stage0.yaml";
function compose(...args: string[]): void {
  execFileSync("docker", ["compose", "-f", FILE, "-p", PROJECT, ...args], {
    cwd: ROOT,
    stdio: "pipe",
  });
}

async function face(port: number): Promise<string> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`);
    return HealthFace.parse(await r.json()).state;
  } catch {
    return "connecting";
  }
}

async function verdict(port: number): Promise<HealthVerdict | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/status`);
    return HealthVerdict.parse(await r.json());
  } catch {
    return null;
  }
}

test.describe.serial("stage 0 — stubs + 3 buckles up, engines not yet", () => {
  test.beforeAll(async () => {
    carol = (
      await Bun.file(`${ROOT}/deploy/keys/.gen/principal.carol@fleet.key`).text()
    ).trim();
  });

  test("compose the first-stage stack", () => {
    compose("up", "-d", "--build");
  });

  // service name → its hub label (the healthz face carries hub labels)
  for (const [n, bucklePort, sidecarPort, label] of [
    ["buckle1", 4911, 4912, "b1"],
    ["buckle2", 4921, 4922, "b2"],
    ["buckle3", 4931, 4932, "b3"],
  ] as const) {
    test(`${n} responds and its sidecar swears it up`, async () => {
      await expect
        .poll(() => face(sidecarPort), { timeout: 30_000 })
        .toBe("up");
      const v = await verdict(sidecarPort);
      expect(v?.ok).toBe(true);
      expect(v?.last_ok).not.toBeNull();
      // the minimal buckle itself answers healthz with the right label
      const h = BuckleHealthz.parse(
        await (await fetch(`http://127.0.0.1:${bucklePort}/healthz`)).json(),
      );
      expect(h.ok).toBe(true);
      expect(h.label).toBe(label);
    });
  }

  // the smoke test that should fail, fails: no engine behind these
  // buckles yet, so the chat round trip is honestly red — asserted as
  // the contract it is (503 problem+json, not a silent 200).
  test("chat is honestly red in stage 0 — 503 problem+json, no engine yet", async () => {
    await expect
      .poll(
        async () => {
          try {
            const r = await fetch("http://127.0.0.1:4911/v1/chat/completions", {
              method: "POST",
              headers: {
                authorization: `Bearer ${carol}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                model: "openai/qwen3-coder",
                messages: [{ role: "user", content: "hello" }],
              }),
            });
            return r.status;
          } catch {
            return 0;
          }
        },
        { timeout: 10_000 },
      )
      .toBe(503);
    const r = await fetch("http://127.0.0.1:4911/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${carol}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/qwen3-coder",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(r.headers.get("content-type")).toContain("application/problem+json");
  });

  test.afterAll(() => {
    compose("down", "-v", "--remove-orphans");
  });
});
