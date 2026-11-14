// buckle.real.ts — launch the three buckles as REAL hubs: live
// catalogs from the recognized providers (openrouter, ms copilot,
// z.ai), real chats through their engines, tokens taken from the
// muramasa runtime home — never typed, never committed.
//
//   bun tools/src/buckle.real.ts render   # keys + engine yaml + env
//   bun tools/src/buckle.real.ts up       # render + boot + prove
//   bun tools/src/buckle.real.ts status   # health + catalog counts
//   bun tools/src/buckle.real.ts down
//
// The machine runtime home (FLEET_BUCKLE_REAL_HOME, default
// ~/.config/fleet-buckle, 0600) carries: keys/ (minted principals +
// peer tokens + provider key COPIES from the muramasa paths in the
// provider registry), engine/ (generated from the LIVE catalogs),
// copilot-tokens/ (the PAT pre-seed litellm's github_copilot reads),
// real.env (provider key VALUES for compose --env-file — machine
// local only). compose.real.yaml is wiring; this tool is the surface.
import { chmodSync, copyFileSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KNOWN_PROVIDERS,
  type KnownProviderLabel,
} from "../../src/schemas/buckle.provider.registry.zod.ts";
import { BuckleModelsResponse } from "../../src/schemas/buckle.model.wire.zod.ts";
import {
  mintIfAbsent,
  mintKey,
  mintTopologyKeys,
  topologyUnits,
} from "./buckle.keys.mint.ts";
import { genRealEngineConfigs } from "./buckle.gen-engine-config.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REAL_HOME =
  process.env["FLEET_BUCKLE_REAL_HOME"] ?? join(homedir(), ".config", "fleet-buckle");
const COMPOSE = ["-f", join(ROOT, "test/deploy/compose.real.yaml"), "--env-file", join(REAL_HOME, "real.env")];

const HUBS = {
  b1: { port: 4711, health: 4712, provider: "openrouter" },
  b2: { port: 4721, health: 4722, provider: "mscopilot" },
  b3: { port: 4731, health: 4732, provider: "zai" },
} as const;

function docker(...args: string[]): { ok: boolean; out: string } {
  const r = Bun.spawnSync(["docker", "compose", ...COMPOSE, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const out = `${r.stdout.toString()}${r.stderr.toString()}`;
  if (r.exitCode !== 0) console.error(out);
  return { ok: r.exitCode === 0, out };
}

/** 0600 atomic write: temp file, chmod, rename — never a readable window */
function writeSecret(file: string, contents: string): void {
  mkdirSync(join(file, ".."), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, contents);
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

async function render(): Promise<void> {
  const keys = join(REAL_HOME, "keys");
  const envValues: Record<string, string> = { REAL_HOME };
  // topology keys: principals + federation peer tokens — the SAME
  // units map the stub mint reads (identical policy; only the
  // provider urls differ — registry real vs stub over layer)
  await mintTopologyKeys(keys, topologyUnits("real"));

  // the ENGINE GATE: one master key minted into the mounted keys dir
  // (the buckles read keys/engine from settings keys.engine); the SAME
  // value rides real.env so every litellm enforces it as master_key
  // NOTE: litellm only ENFORCES master keys with the sk- prefix —
  // a bksk_-style value silently disables engine auth
  envValues["ENGINE_MASTER_KEY"] = await mintIfAbsent(
    join(keys, "engine.master.key"),
    () => mintKey("sk-engine-"),
  );

  // provider keys: COPIED from the muramasa paths the registry names
  // (env override <LABEL>_KEY_PATH), so the runtime home is complete
  for (const label of Object.keys(KNOWN_PROVIDERS) as KnownProviderLabel[]) {
    const known = KNOWN_PROVIDERS[label];
    const src =
      process.env[`${label.toUpperCase()}_KEY_PATH`] ??
      known.key_file.replace("~", homedir());
    const dst = join(keys, `${label}.key`);
    if (statSync(src, { throwIfNoEntry: false }) === undefined)
      throw new Error(`${label}: key not found at ${src} (set ${label.toUpperCase()}_KEY_PATH)`);
    copyFileSync(src, dst);
    chmodSync(dst, 0o600);
    envValues[known.key_env] = (await Bun.file(dst).text()).trim();
  }

  // the copilot PAT pre-seed (litellm's github_copilot provider reads
  // the token cache before falling back to device flow)
  const tokens = join(REAL_HOME, "copilot-tokens");
  mkdirSync(tokens, { recursive: true });
  const pat = envValues[KNOWN_PROVIDERS.mscopilot.key_env];
  writeSecret(join(tokens, "access-token"), `${pat}\n`);
  writeSecret(
    join(tokens, "api-key.json"),
    `${JSON.stringify({
      token: pat,
      expires_at: 4102444800, // 2100-01-01: the PAT has no seat expiry
      endpoints: { api: KNOWN_PROVIDERS.mscopilot.url },
    })}\n`,
  );

  // engine configs from the LIVE catalogs
  await genRealEngineConfigs(join(REAL_HOME, "engine"));

  // real.env: machine-local compose interpolation (0600)
  writeSecret(
    join(REAL_HOME, "real.env"),
    Object.entries(envValues).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
  );
  console.log(`rendered: ${REAL_HOME} (keys, engine/, copilot-tokens/, real.env)`);
}

async function waitHealth(port: number, ms = 60_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await Bun.sleep(1000);
  }
  return false;
}

async function prove(): Promise<void> {
  const federation = (await Bun.file(join(REAL_HOME, "keys", "principal.federation@fleet.key")).text()).trim();
  let failures = 0;
  for (const [name, hub] of Object.entries(HUBS)) {
    const healthy = await waitHealth(hub.health);
    const models = await fetch(`http://127.0.0.1:${hub.port}/v1/models`, {
      headers: { authorization: `Bearer ${federation}` },
    });
    const parsed = BuckleModelsResponse.safeParse(await models.json());
    const rows = parsed.success ? parsed.data.models.length : -1;
    const ok = healthy && models.ok && rows > 0;
    if (!ok) failures++;
    console.log(
      `${ok ? "✓" : "✗"} ${name} (${hub.provider}): health=${healthy} catalog=${rows} rows`,
    );
  }
  if (failures > 0) {
    console.error(`${failures} hub(s) failed the real check`);
    process.exit(1);
  }
}

const verb = process.argv[2];
if (verb === "render") await render();
else if (verb === "up") {
  await render();
  // --force-recreate: a fresh render may only change the MOUNTED
  // engine yaml — up -d alone would keep a running litellm on the
  // stale config (bind mounts update live; litellm reads at boot)
  if (!docker("up", "-d", "--build", "--force-recreate").ok) process.exit(1);
  await prove();
  console.log("real stack up: b1 4711 · b2 4721 · b3 4731 · jaeger 16686");
} else if (verb === "status") {
  docker("ps");
  await prove();
} else if (verb === "down") {
  docker("down").ok || process.exit(1);
} else {
  console.error("usage: bun tools/src/buckle.real.ts <render|up|status|down>");
  process.exit(1);
}
