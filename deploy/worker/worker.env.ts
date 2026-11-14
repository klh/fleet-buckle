// worker.env.ts — the environment contract: EVERY WORKER_* / BUCKLE_*
// knob this service reads lives here and nowhere else. Compartmentalized
// so the durable rework and the seed lift can rebind hosts (gh url,
// buckle url, wake addr) without touching policy code. Secrets are
// file-first (0600 mounts), env fallback — never baked into any image.
import { readFileSync } from "node:fs";

/** a mounted secret file, falling back to env when absent */
const readSecret = (path: string, envName: string): string => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return process.env[envName] ?? "";
  }
};

export const env = {
  repo: process.env.WORKER_REPO ?? "icomdev/calculon",
  ghUrl: process.env.WORKER_GH_URL ?? "https://api.github.com",
  token: readSecret(process.env.WORKER_TOKEN_FILE ?? "/run/secrets/worker_token", "WORKER_TOKEN"),
  buckle: process.env.BUCKLE_URL ?? "http://buckle3:4111",
  buckleKey: readSecret(process.env.BUCKLE_KEY_FILE ?? "/run/secrets/buckle_key", "BUCKLE_KEY"),
  lane: process.env.WORKER_LANE ?? "b3-repoagent-v1-calculon",
  // the durable store (pi-durable SQLite journal; a compose volume):
  // the sweep loop's task graph + the repoagent.state doc live here
  storePath: process.env.WORKER_STORE ?? "/state/worker.sqlite",
  pollSeconds: Number(process.env.WORKER_POLL_SECONDS ?? 20),
  dockerSock: process.env.DOCKER_SOCK ?? "/var/run/docker.sock",
  pagesUrl: process.env.WORKER_PAGES_URL ?? `https://icomdev.github.io/calculon/`,
  // the WAKE face: GitHub webhooks (or the gh-stub) POST here for an
  // immediate sweep; the poll stays the reconciliation backstop
  wakeAddr: process.env.WORKER_WAKE_ADDR ?? "",
  webhookSecret: process.env.WORKER_WEBHOOK_SECRET ?? "",
  // scope guard: when set, only issues whose TITLE starts with this
  // prefix are swept — the real-repo proof must never touch human work
  issuePrefix: process.env.WORKER_ISSUE_PREFIX ?? "",
} as const;
