// Shared Docker topology lifecycle, called by Playwright setup/teardown
// projects. Isolated Azure and stage0 projects do not use this stack.
import { stackDown, stackUp as composeUp } from "./buckle.kit.compose.ts";
import { genEngineConfigs } from "../../tools/src/buckle.gen-engine-config.ts";

/** the demo keys are MINTED and the engine configs GENERATED before
 * the stack boots: keys are never typed (per-principal 0600 files into
 * test/deploy/keys/.gen, mounted at /etc/buckle/keys), and the litellm
 * deployments come from the REAL captured catalogs so engine ids and
 * catalog ids can never drift. */
export async function stackUp(): Promise<void> {
  const { execSync } = await import("node:child_process");
  const cwd = new URL("../..", import.meta.url).pathname;
  execSync("bun tools/src/buckle.mint-keys.ts", {
    encoding: "utf8",
    stdio: "inherit",
    cwd,
  });
  genEngineConfigs();
  await composeUp();
}

export { stackDown };

/** per-rig isolation: BUCKLE_RIG (name) picks the compose project suffix
 *  and BUCKLE_RIG_OFFSET (integer) shifts every host port, so parallel
 *  hermetic rigs never collide. */
const OFF = Number(process.env["BUCKLE_RIG_OFFSET"] ?? "0");
if (!Number.isInteger(OFF) || OFF < 0 || OFF > 1000)
  throw new Error("BUCKLE_RIG_OFFSET must be an integer 0..1000");

/** host ports of the demo topology — the single port truth for specs */
export const PORTS = {
  b1: 4711 + OFF,
  b1Health: 4712 + OFF,
  b2: 4721 + OFF,
  b2Health: 4722 + OFF,
  b3: 4731 + OFF,
  b3Health: 4732 + OFF,
  jaeger: 16686 + OFF,
  otlpGrpc: 4317 + OFF,
  otlpHttp: 4318 + OFF,
  ghStub: 4741 + OFF,
  zaiSeen: 4742 + OFF,
  workerWake: 4743 + OFF,
} as const;

export const SERVICES = [
  "jaeger",
  "openrouter-stub",
  "mscopilot-stub",
  "zai-stub",
  "litellm1",
  "litellm2",
  "litellm3",
  "health1",
  "health2",
  "health3",
  "buckle1",
  "buckle2",
  "buckle3",
] as const;
