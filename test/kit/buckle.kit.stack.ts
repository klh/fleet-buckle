// buckle.kit.stack.ts — the stack lifecycle is GLOBAL: one boot for the
// whole playwright run (globalSetup/globalTeardown call these), every
// project's specs hit the same Docker Desktop topology. docker only —
// no local mode; compose is the topology of record.
import { stackDown, stackUp as composeUp } from "./buckle.kit.compose.ts";
import { genEngineConfigs } from "../../tools/src/buckle.gen-engine-config.ts";

/** the demo keys are MINTED and the engine configs GENERATED before
 * the stack boots: keys are never typed (per-principal 0600 files into
 * deploy/keys/.gen, mounted at /etc/buckle/keys), and the litellm
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
  composeUp();
}

export { stackDown };

/** host ports of the demo topology — the single port truth for specs */
export const PORTS = {
  b1: 4711,
  b1Health: 4712,
  b2: 4721,
  b2Health: 4722,
  b3: 4731,
  b3Health: 4732,
  jaeger: 16686,
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
