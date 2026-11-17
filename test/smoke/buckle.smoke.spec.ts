// smoke — shared-stack project, runs after stack-setup:
//   a) the docker engine is running
//   b) the correct versions of the 3 buckles are running (all 16 services
//      of the demo topology, built from THIS source)
//   c) they are healthy — via the fleet-health sidecars, never the
//      processes themselves. The server landed (commit 3): the honest
//      verdict is now `up` for all three — the flip from the pre-server
//      truth (down) is itself the proof the sidecars tell the truth.
import { test, expect } from "../fixtures/buckle.health.fixture.ts";
import { execSync } from "node:child_process";
import { PORTS, SERVICES } from "../kit/buckle.kit.stack.ts";
import { psMap } from "../kit/buckle.kit.compose.ts";

test("a) the docker engine is running", () => {
  const version = execSync("docker info --format {{.ServerVersion}}", {
    encoding: "utf8",
  }).trim();
  expect(version).toMatch(/^\d+\.\d+/);
});

test("b) the correct versions of the 3 buckles are running (full stack, this build)", async () => {
  // boot is a CHAIN: engines warm (litellm self-heals through its
  // cold-boot Prometheus flake via restart: on-failure) and worker4
  // picks only once a hub answers — a single-shot ps would see the
  // legitimate restarting window. Poll: every service converges to
  // running, bounded, or the test fails honestly.
  for (const svc of SERVICES) {
    await expect
      .poll(() => Promise.resolve(psMap()[svc]), {
        timeout: 120_000,
        message: `service ${svc} must be RUNNING (not exited/restarting)`,
      })
      .toBe("running");
  }
  // built-from-this-source: 16 containers of OUR project; the 3 buckles
  // run OUR project's built images (not a registry pull)
  const names = execSync(
    "docker ps -a --filter label=com.docker.compose.project=fleet-buckle-test --format {{.Names}}",
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
  expect(names.length, "container count").toBeGreaterThanOrEqual(SERVICES.length);
  const buckleNames = names.filter((n) => /buckle[123]-\d+$/.test(n));
  expect(buckleNames.length).toBe(3);
  for (const n of buckleNames) {
    const image = execSync(`docker inspect -f {{.Config.Image}} ${n}`, {
      encoding: "utf8",
    }).trim();
    expect(image).toContain("fleet-buckle-test-buckle");
  }
});

test.setTimeout(120_000);
test("c) verdict: ALL THREE buckles are up — the server serves", async ({ healthState }) => {
  // the fleet-health sidecars poll the real targets; expect.poll does not
  // catch throws — the poll fn must be total
  for (const port of [PORTS.b1Health, PORTS.b2Health, PORTS.b3Health]) {
    await expect.poll(() => healthState(port), { timeout: 60_000 }).toBe("up");
  }
});

test("schema contracts hold (openapi in sync, fixtures parse, settings compose)", async () => {
  const { execSync: exec } = await import("node:child_process");
  exec("bun tools/src/buckle.gen-openapi.ts --check");
  const { BuckleTreeResponse, mergeSettings } = await import("../../src/schemas/index.ts");
  const { default: defaults } = await import("../../deploy/settings/default.settings.json5");
  const { default: b1 } = await import("../../test/deploy/settings/b1.settings.json5");
  const { default: demoTree } = await import("../deploy/fixtures/tree.demo.json");
  const merged = mergeSettings(defaults, b1);
  expect(merged.hub.label).toBe("b1");
  expect(Object.keys(merged.hubs ?? {}).sort()).toEqual(["b2", "b3"]);
  const tree = BuckleTreeResponse.parse(demoTree);
  expect(tree.self.buckle.label).toBe("b1");
});
