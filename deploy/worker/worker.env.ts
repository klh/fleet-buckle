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

const REPO_DEFAULT = "icomdev/calculon";
const repo = process.env["WORKER_REPO"] ?? REPO_DEFAULT;

export const env = {
  repo,
  ghUrl: process.env["WORKER_GH_URL"] ?? "https://api.github.com",
  token: readSecret(process.env["WORKER_TOKEN_FILE"] ?? "/run/secrets/worker_token", "WORKER_TOKEN"),
  buckle: process.env["BUCKLE_URL"] ?? "http://buckle3:4111",
  buckleKey: readSecret(process.env["BUCKLE_KEY_FILE"] ?? "/run/secrets/buckle_key", "BUCKLE_KEY"),
  lane: process.env["WORKER_LANE"] ?? "b3-repoagent-v1-calculon",
  // BYOC worlds (azure seat lanes): the credential rides the URL
  // (/w/<lane>/<token> — forwarded verbatim upstream); principal worlds
  // (the hermetic rig, dave@fleet) keep the Bearer-header form and the
  // provider key upstream. One worker, two topologies, one knob.
  byoc: (process.env["WORKER_BYOC"] ?? "false") === "true",
  // the durable store (pi-durable SQLite journal; a compose volume):
  // the sweep loop's task graph + the repoagent.state doc live here
  storePath: process.env["WORKER_STORE"] ?? "/state/worker.sqlite",
  pollSeconds: Number(process.env["WORKER_POLL_SECONDS"] ?? 20),
  dockerSock: process.env["DOCKER_SOCK"] ?? "/var/run/docker.sock",
  // the MERGED site (GitHub Pages, owner/name derived); per-BRANCH
  // previews ride raw.githack (computed at the call site)
  pagesUrl:
    process.env["WORKER_PAGES_URL"] ??
    `https://${repo.split("/")[0]}.github.io/${repo.split("/")[1]}/`,
  // the WAKE face: GitHub webhooks (or the gh-stub) POST here for an
  // immediate sweep; the poll stays the reconciliation backstop
  wakeAddr: process.env["WORKER_WAKE_ADDR"] ?? "",
  webhookSecret: process.env["WORKER_WEBHOOK_SECRET"] ?? "",
  // scope guard: when set, only issues whose TITLE starts with this
  // prefix are swept — the real-repo proof must never touch human work
  issuePrefix: process.env["WORKER_ISSUE_PREFIX"] ?? "",
  // the .prefer startup file (owner ruling 2026-11-16): ordered model
  // allow-list + hub candidates + knobs; absent file = picker off,
  // the worker rides the lane topology as before
  preferFile: process.env["WORKER_PREFER_FILE"] ?? "/etc/worker/.prefer",
  // the seed dir (ro, baked into the image at /etc/worker — mounts
  // overwrite): persona.md (character, rarely changes) + template.md
  // (the incoming per-mission brief — the pi-durable template
  // pattern) + .prefer (the model ladder)
  personaFile: process.env["WORKER_PERSONA_FILE"] ?? "/etc/worker/persona.md",
  templateFile: process.env["WORKER_TEMPLATE_FILE"] ?? "/etc/worker/template.md",
  // the seed dir's hub label map — `hub=mscopopolit` in .prefer
  // resolves through it (the fleet's hubs.json pattern)
  hubsFile: process.env["WORKER_HUBS_FILE"] ?? "/etc/worker/hubs.json",
} as const;
