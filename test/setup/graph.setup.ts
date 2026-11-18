// graph setup: refuse unpinned worker image / live fixtures, then bounded
// readiness of all three buckles (stack-setup booted them).
import { test } from "@playwright/test";
import { assertIsolatedFixtures, ready, workerImage } from "../kit/buckle.kit.registry.ts";
import { PORTS } from "../kit/buckle.kit.stack.ts";
import { face } from "../kit/buckle.kit.health.ts";

test("graph preconditions: pinned published worker image, isolated fixtures", () => {
  workerImage();
  assertIsolatedFixtures();
});

test("bounded readiness: every buckle health face is up", async () => {
  test.setTimeout(150_000);
  for (const p of [PORTS.b1Health, PORTS.b2Health, PORTS.b3Health])
    await ready(`health ${p}`, async () => (await face(p)) === "up");
});
