// buckle.kit.compose.ts — the compose driver: docker-only harness (the
// specs always hit the real Docker Desktop topology). One project name,
// deterministic service set, json output for asserts.
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const COMPOSE_FILE = `${ROOT}/test/deploy/compose.test.yaml`;
const RIG = process.env["BUCKLE_RIG"] ?? "";
if (!/^[a-z0-9-]*$/.test(RIG)) throw new Error("BUCKLE_RIG must match [a-z0-9-]*");
export const PROJECT = RIG === "" ? "fleet-buckle-test" : `fleet-buckle-test-${RIG}`;
const OFF = Number(process.env["BUCKLE_RIG_OFFSET"] ?? "0");
// same port truth as buckle.kit.stack.ts PORTS (kept dependency-free here)
const base: Record<string, number> = { P_JAEGER: 16686, P_OTLPG: 4317, P_OTLPH: 4318, P_ZAISEEN: 4742, P_B1: 4711, P_B1H: 4712, P_B2: 4721, P_B2H: 4722, P_B3: 4731, P_B3H: 4732 };
const ENV = {
  ...process.env,
  ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, String(v + OFF)])),
};

export function compose(args: string): string {
  return execSync(`docker compose -f ${COMPOSE_FILE} -p ${PROJECT} ${args}`, {
    encoding: "utf8",
    env: ENV,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** compose against ANOTHER stack (stage0, rolling): any file, any
 *  project — the specs that own their own topology reuse this driver
 *  instead of re-rolling execFileSync. */
export function composeOn(file: string, project: string, ...args: string[]): void {
  execFileSync("docker", ["compose", "-f", file, "-p", project, ...args], {
    cwd: ROOT,
    stdio: "pipe",
  });
}

export async function stackUp(): Promise<void> {
  execSync(`docker compose -f ${COMPOSE_FILE} -p ${PROJECT} up -d --build`, {
    encoding: "utf8",
    env: ENV,
    stdio: "inherit",
  });
}

export function stackDown(): void {
  execSync(`docker compose -f ${COMPOSE_FILE} -p ${PROJECT} down -v --remove-orphans`, {
    encoding: "utf8",
    env: ENV,
    stdio: "inherit",
  });
}

/** compose ps as a service -> state map (json). */
export function psMap(): Record<string, string> {
  const out = compose("ps --all --format json");
  const rows = out
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, string>);
  const map: Record<string, string> = {};
  for (const r of rows) {
    const svc = r["Service"];
    if (svc !== undefined) map[svc] = r["State"] ?? "unknown";
  }
  return map;
}
