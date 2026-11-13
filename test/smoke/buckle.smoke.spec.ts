// smoke — PROJECT 1, runs first, no deps:
//   a) the docker engine is running
//   b) the correct versions of the 3 buckles are running (all 13 services
//      of the demo topology, built from THIS source)
//   c) they are healthy — via the fleet-health sidecars, never the
//      processes themselves. The server landed (commit 3): the honest
//      verdict is now `up` for all three — the flip from the pre-server
//      truth (down) is itself the proof the sidecars tell the truth.
import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { HealthFace } from "@fleet/health";
import { PORTS, SERVICES } from "../kit/buckle.kit.stack.ts";
import { psMap } from "../kit/buckle.kit.compose.ts";

test("a) the docker engine is running", () => {
  const version = execSync("docker info --format {{.ServerVersion}}", {
    encoding: "utf8",
  }).trim();
  expect(version).toMatch(/^\d+\.\d+/);
});

test("b) the correct versions of the 3 buckles are running (full stack, this build)", () => {
  const ps = psMap();
  for (const svc of SERVICES) {
    expect(ps[svc], `service ${svc} in compose ps`).toBeDefined();
    expect(ps[svc], `service ${svc} must be RUNNING (not exited)`).toBe(
      "running",
    );
  }
  // built-from-this-source: 13 containers of OUR project; the 3 buckles
  // run OUR project's built images (not a registry pull)
  const names = execSync(
    "docker ps -a --filter label=com.docker.compose.project=fleet-buckle-test --format {{.Names}}",
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter((l) => l.length > 0);
  expect(names.length).toBe(SERVICES.length);
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
test("c) verdict: ALL THREE buckles are up — the server serves", async () => {
  // the fleet-health sidecars poll the real targets; expect.poll does not
  // catch throws — the poll fn must be total
  const verdictState = async (port: number): Promise<string> => {
    try {
      // /healthz is the COMPACT face — parse it with HealthFace
      // (the full /status body is the HealthVerdict shape)
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      return HealthFace.parse(await r.json()).state;
    } catch {
      return "connecting";
    }
  };
  for (const port of [PORTS.b1Health, PORTS.b2Health, PORTS.b3Health]) {
    await expect
      .poll(() => verdictState(port), { timeout: 60_000 })
      .toBe("up");
  }
});

test("schema contracts hold (openapi in sync, fixtures parse, settings compose)", async () => {
  const { execSync: exec } = await import("node:child_process");
  exec("bun tools/src/buckle.gen-openapi.ts --check");
  const { BuckleTreeResponse, mergeSettings } = await import(
    "../../src/schemas/index.ts"
  );
  const { default: defaults } = await import(
    "../../deploy/settings/default.settings.json5"
  );
  const { default: b1 } = await import("../../deploy/settings/b1.settings.json5");
  const { default: demoTree } = await import(
    "../../src/schemas/fixtures/tree.demo.json"
  );
  const merged = mergeSettings(defaults, b1);
  expect(merged.hub.label).toBe("b1");
  expect(Object.keys(merged.hubs ?? {}).sort()).toEqual(["b2", "b3"]);
  const tree = BuckleTreeResponse.parse(demoTree);
  expect(tree.self.buckle.label).toBe("b1");
});
