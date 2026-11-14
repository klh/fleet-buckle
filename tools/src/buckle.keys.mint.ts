// buckle.keys.mint.ts — secrets are MINTED, never typed. ONE minter
// for every mode: per-principal key files (0600) generated from each
// unit's access registry into the keys dir, the shared federation
// principal key, and the peer tokens hubs use to pull each other
// (`peer-<label>.token` carries the federation value — one secret,
// many mounts). Idempotent: existing files keep their value.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSettings } from "../../src/server/buckle.server.settings.ts";

export function mintKey(value = "bksk_"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `${value}${Buffer.from(bytes).toString("base64url")}`;
}

/** mint the file if absent (0600); always returns its CURRENT value */
export async function mintIfAbsent(file: string, generate: () => string): Promise<string> {
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) {
    writeFileSync(file, `${generate()}\n`);
    chmodSync(file, 0o600);
  }
  return (await Bun.file(file).text()).trim();
}

export type UnitSettingsPaths = Parameters<typeof loadSettings>[0];

/** mint the full topology key set for `dir`: every unit's principals
 *  plus a peer token per unit's hubs entry (the shared federation
 *  principal key rides each — one secret, many mounts). */
export async function mintTopologyKeys(
  dir: string,
  units: Record<string, UnitSettingsPaths>,
): Promise<void> {
  const federation = await mintIfAbsent(
    join(dir, "principal.federation@fleet.key"),
    () => mintKey(),
  );
  for (const unit of Object.values(units)) {
    const settings = await loadSettings(unit);
    for (const p of settings.access?.principals ?? []) {
      await mintIfAbsent(join(dir, `principal.${p.id}.key`), () => mintKey());
    }
    for (const label of Object.keys(settings.hubs ?? {})) {
      await mintIfAbsent(join(dir, `peer-${label}.token`), () => federation);
    }
  }
}
