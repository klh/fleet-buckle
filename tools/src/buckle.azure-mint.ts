// buckle.azure-mint.ts — the tabula-rasa hub's ONE-SHOT key mint
// (compose profile `mint`): every principal DECLARED in the azure
// settings gets its 0600 key file in the keys dir (idempotent —
// existing keys are never overwritten). BYOC needs nothing here:
// copilot credentials ride user requests and are minted NOWHERE.
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { loadSettings } from "../../src/settings.ts";
import { mintIfAbsent, mintKey } from "./buckle.keys.mint.ts";

const dir = process.argv[2];
if (dir === undefined) {
  console.error("usage: bun buckle.azure-mint.ts <keys-dir> [defaults] [settings]");
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

// e2e passes explicit paths (hermetic fixtures, resolved against
// cwd); the compose profile rides the /etc mounts — one tool, both
// worlds
const defaults = process.argv[3] ?? "/etc/buckle/default.settings.json5";
const settingsPath = process.argv[4] ?? "/etc/buckle/settings.json5";

const settings = await loadSettings({
  defaults: resolve(defaults),
  settings: resolve(settingsPath),
});
for (const p of settings.access?.principals ?? []) {
  const key = await mintIfAbsent(join(dir, `principal.${p.id}.key`), () => mintKey());
  console.log(`minted ${p.id} → ${join(dir, `principal.${p.id}.key`)}`);
  // the key value never prints — secrets are paths
  void key;
}

// the GUI session seal (HMAC secret for the OIDC front door's
// cookie) — minted like every key: random, 0600, never printed,
// never overwritten
await mintIfAbsent(join(dir, "session.key"), () => randomBytes(32).toString("hex"));
console.log(`minted session seal → ${join(dir, "session.key")}`);
