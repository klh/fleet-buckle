// buckle.kit.compose.ts — the compose driver: docker-only harness (the
// specs always hit the real Docker Desktop topology). One project name,
// deterministic service set, json output for asserts.
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const COMPOSE_FILE = `${ROOT}/deploy/compose.test.yaml`;
export const PROJECT = "fleet-buckle-test";

export function compose(args: string): string {
  return execSync(
    `docker compose -f ${COMPOSE_FILE} -p ${PROJECT} ${args}`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** compose against ANOTHER stack (stage0, rolling): any file, any
 *  project — the specs that own their own topology reuse this driver
 *  instead of re-rolling execFileSync. */
export function composeOn(
  file: string,
  project: string,
  ...args: string[]
): void {
  execFileSync("docker", ["compose", "-f", file, "-p", project, ...args], {
    cwd: ROOT,
    stdio: "pipe",
  });
}

export async function stackUp(): Promise<void> {
  execSync(
    `docker compose -f ${COMPOSE_FILE} -p ${PROJECT} up -d --build`,
    { encoding: "utf8", stdio: "inherit" },
  );
}

export function stackDown(): void {
  execSync(
    `docker compose -f ${COMPOSE_FILE} -p ${PROJECT} down -v --remove-orphans`,
    { encoding: "utf8", stdio: "inherit" },
  );
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
