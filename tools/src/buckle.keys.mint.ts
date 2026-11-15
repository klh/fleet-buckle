// buckle.keys.mint.ts — the topology POLICY home for key minting
// (which units, which principals, which peer tokens): the VALUE
// minter + atomic writer live in ONE place — src/admin's
// buckle.admin.control.ts (mintKey/mintIfAbsent) — and this module
// composes them into the three-buckle topology: per-principal key
// files (0600) generated from each unit's access registry into the
// keys dir, the shared federation principal key, and the peer
// tokens hubs use to pull each other (`peer-<label>.token` carries
// the federation value — one secret, many mounts). Idempotent:
// existing files keep their value.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSettings } from "../../src/settings.ts";
import { mintIfAbsent, mintKey } from "../../src/admin/buckle.admin.control.ts";

export { mintIfAbsent, mintKey };

export type UnitSettingsPaths = Parameters<typeof loadSettings>[0];

/** the three-buckle topology's settings map — the ONE home (stub mode
 *  adds the stub-url over layer; real mode rides registry defaults).
 *  Unit topology lives in test/deploy/settings; deploy/settings
 *  carries the real single hub only. */
export function topologyUnits(mode: "stub" | "real"): Record<string, UnitSettingsPaths> {
  const ROOT = fileURLToPath(new URL("../..", import.meta.url));
  const units: Record<string, UnitSettingsPaths> = {};
  for (const label of ["b1", "b2", "b3"]) {
    units[label] = {
      defaults: join(ROOT, "deploy/settings/default.settings.json5"),
      settings: join(ROOT, `test/deploy/settings/${label}.settings.json5`),
      ...(mode === "stub" ? { over: join(ROOT, `test/deploy/settings/${label}.stub.json5`) } : {}),
    };
  }
  return units;
}

/** mint the full topology key set for `dir`: every unit's principals
 *  plus a peer token per unit's hubs entry (the shared federation
 *  principal key rides each — one secret, many mounts). */
export async function mintTopologyKeys(
  dir: string,
  units: Record<string, UnitSettingsPaths>,
): Promise<void> {
  const federation = await mintIfAbsent(join(dir, "principal.federation@fleet.key"), () =>
    mintKey(),
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
