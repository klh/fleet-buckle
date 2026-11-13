// buckle.mint-keys.ts — secrets are MINTED, never typed: per-principal
// key files (0600) generated from each buckle's access registry into
// deploy/keys/.gen (gitignored), which compose mounts read-only at
// /etc/buckle/keys. Idempotent: existing files keep their value.
import { mkdirSync, chmodSync, existsSync, writeFileSync } from "node:fs";
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
