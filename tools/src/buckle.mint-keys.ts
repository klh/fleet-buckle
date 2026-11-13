// buckle.mint-keys.ts — secrets are MINTED, never typed: per-principal
// key files (0600) generated from each buckle's access registry into
// deploy/keys/.gen (gitignored), which compose mounts read-only at
// /etc/buckle/keys. Idempotent: existing files keep their value.
import { mkdirSync, chmodSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSettings } from "../../src/server/buckle.server.settings.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const KEYS = join(ROOT, "deploy/keys/.gen");

function mint(value: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = Buffer.from(bytes).toString("base64url");
  return `${value}${token}`;
}

mkdirSync(KEYS, { recursive: true });

// the federation principal: one key, valid on EVERY buckle of the demo
// (each mounts the same keys dir); peer pulls ride its token files
const federationKey = join(KEYS, "principal.federation@fleet.key");
if (!existsSync(federationKey)) {
  writeFileSync(federationKey, mint("bksk_") + "\n");
  chmodSync(federationKey, 0o600);
  console.log("minted federation principal key");
}
const federationValue = readFileSync(federationKey, "utf8").trim();
for (const peer of ["peer-b2.token", "peer-b3.token"]) {
  const t = join(KEYS, peer);
  if (!existsSync(t)) {
    writeFileSync(t, federationValue + "\n");
    chmodSync(t, 0o600);
    console.log(`minted ${peer}`);
  }
}

for (const name of ["b1", "b2", "b3"]) {
  const settings = await loadSettings({
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, `deploy/settings/${name}.settings.json5`),
  });
  for (const p of settings.access?.principals ?? []) {
    const file = join(KEYS, `principal.${p.id}.key`);
    if (existsSync(file)) continue; // idempotent
    writeFileSync(file, mint("bksk_") + "\n");
    chmodSync(file, 0o600);
    console.log(`minted ${name}: principal.${p.id}.key`);
  }
}
console.log(`keys dir: ${KEYS}`);
