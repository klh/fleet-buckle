// rolling — the ROLLING DEPLOY proof for one unit: a new version of
// the buckle comes up BEHIND the front, is gated healthy by its own
// fleet-health sidecar, takes traffic by a state-file flip, and the
// old version drains away — with zero dropped requests through the
// front the whole time. The front's user-surface sidecar never goes
// down: that constancy IS the zero-downtime claim, sworn outside the
// process.
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { HealthFace, HealthVerdict } from "@fleet/health";
import { BuckleHealthz } from "../../src/schemas/buckle.healthz.zod.ts";

const PROJECT = "fleet-buckle-rolling";
const ROOT = new URL("../..", import.meta.url).pathname;
const FRONT = "http://127.0.0.1:4811";
const V1 = "http://buckle1v1:4111";
const V2 = "http://buckle1v2:4111";
const STATE = `${ROOT}/deploy/roll/b1.active.json`; // inside the mounted dir

const FILE = "deploy/compose.rolling.yaml";
function compose(...args: string[]): void {
  execFileSync("docker", ["compose", "-f", FILE, "-p", PROJECT, ...args], {
    cwd: ROOT,
    stdio: "pipe",
  });
}

/** the flip — SAME-INODE write: a host-side rename replaces the inode
 * and VirtioFS never shows it to the container. The front's
 * last-known-good makes the (rare) torn read harmless: it serves the
 * previous version until a clean read lands. */
function flip(upstream: string): void {
  writeFileSync(STATE, `${JSON.stringify({ upstream })}\n`);
}

let carol = "";

async function chat(
  port: number,
): Promise<{ status: number; upstream: string | null }> {
  try {
    const r = await fetch(`${port === 4811 ? FRONT : `http://127.0.0.1:${port}`}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${carol}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "openai/qwen3-coder",
        messages: [{ role: "user", content: "rolling" }],
      }),
    });
    return { status: r.status, upstream: r.headers.get("x-buckle-upstream") };
  } catch {
    return { status: 0, upstream: null };
  }
}

async function healthzThroughFront(): Promise<BuckleHealthz> {
  const r = await fetch(`${FRONT}/healthz`);
  return BuckleHealthz.parse(await r.json());
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

test.describe.serial("rolling deploy — unit b1 v1 → v2, no downtime", () => {
  test.beforeAll(async () => {
    carol = (await Bun.file(`${ROOT}/deploy/keys/.gen/principal.carol@fleet.key`).text()).trim();
    flip(V1); // the roll starts from v1
    compose("up", "-d", "--build");
  });

  test("v1 serves through the front", async () => {
    await expect
      .poll(async () => (await chat(4811)).status, { timeout: 30_000 })
      .toBe(200);
    const r = await chat(4811);
    expect(r.upstream).toBe(V1);
    const h = await healthzThroughFront();
    expect(h.label).toBe("b1");
    expect(h.version).toBeUndefined(); // v1 carries no version stamp
  });

  test("the unit surface sidecar is up and stays up (the contract)", async () => {
    await expect.poll(() => face(4812), { timeout: 30_000 }).toBe("up");
    const v = await verdict(4812);
    expect(v?.ok).toBe(true);
    expect(v?.last_ok).not.toBeNull();
  });

  test("the new version gates healthy BEFORE traffic flips", async () => {
    // v2's own sidecar swears it up — direct, not through the front
    await expect.poll(() => face(4832), { timeout: 30_000 }).toBe("up");
    // v2 answers with the version stamp (visible before any switch)
    const h = BuckleHealthz.parse(
      await (await fetch("http://127.0.0.1:4831/healthz")).json(),
    );
    expect(h.label).toBe("b1");
    expect(h.version).toBe("v2-rolling");
    // v2 can chat (shared engine) — the new version is READY, not just alive
    const r = await chat(4831);
    expect(r.status).toBe(200);
  });

  test("the switch under load — no dropped request across the flip", async () => {
    // BEFORE: a stream of chats, every one served by v1
    const before: { status: number; upstream: string | null }[] = [];
    for (let i = 0; i < 6; i++) before.push(await chat(4811));
    expect(before.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(before.every((r) => r.upstream === V1)).toBe(true);

    // THE SWITCH: one same-inode write. The front reads state per
    // request — no connection is broken, nothing is queued or dropped
    flip(V2);

    // AFTER: the stream continues without a gap — every one 200, all
    // on the new version (the stamp is visible through the front)
    const after: { status: number; upstream: string | null }[] = [];
    for (let i = 0; i < 12; i++) after.push(await chat(4811));
    expect(after.map((r) => r.status)).toEqual(Array(12).fill(200));
    expect(after.every((r) => r.upstream === V2)).toBe(true);
    const h = await healthzThroughFront();
    expect(h.version).toBe("v2-rolling");

    // the unit surface sidecar NEVER went down across the switch
    const v = await verdict(4812);
    expect(v?.ok).toBe(true);
  });

  test("drain — v1 stops, the front never blinks", async () => {
    compose("stop", "buckle1v1");
    for (let i = 0; i < 6; i++) {
      const r = await chat(4811);
      expect(r.status).toBe(200);
      expect(r.upstream).toBe(V2);
    }
    const v = await verdict(4812);
    expect(v?.ok).toBe(true);
    expect(v?.last_ok).not.toBeNull();
  });

  test.afterAll(() => {
    compose("down", "-v", "--remove-orphans");
    flip(V1); // leave the committed default for the next run
  });
});
