// settings.ts — THE one way settings load: default ⊕ buckle ⊕ over,
// JSON5 all (Bun imports it natively), deep-merged through
// mergeSettings, safeParse'd. The over layer is the mode switch: the
// SAME unit file serves real mode (no over — registry default
// endpoints) and stub mode (over injects stub urls). This file is
// ALSO the only place src/ touches process.env or CATCHES a
// filesystem read: every knob (timeouts, telemetry, engine url,
// ports, key PATHS) lives in settings — one home — and the token/dir
// readers classify + log their faults instead of swallowing.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { z } from "zod";
import { classifyFault, logFault } from "./fault.ts";
import { mergeSettings, type BuckleSettings } from "./schemas/buckle.settings.zod.ts";

export const SettingsPathsSchema = z
  .object({
    defaults: z.string().min(1),
    settings: z.string().min(1),
    /** optional mode overlay (stub urls over registry defaults) */
    over: z.string().min(1).optional(),
  })
  .strict();
export type SettingsPaths = z.output<typeof SettingsPathsSchema>;

export function resolveSettingsPaths(args: string[]): SettingsPaths {
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const defaults =
    flag("defaults") ?? process.env["BUCKLE_DEFAULTS"] ?? "deploy/settings/default.settings.json5";
  const settings =
    flag("settings") ?? process.env["BUCKLE_SETTINGS"] ?? "deploy/settings/b1.settings.json5";
  const over = flag("over") ?? process.env["BUCKLE_SETTINGS_OVER"];
  // absent (empty string) = no overlay: real mode rides the registry
  return over === undefined || over === "" ? { defaults, settings } : { defaults, settings, over };
}

export async function loadSettings(paths: SettingsPaths): Promise<BuckleSettings> {
  const base = (await import(paths.defaults, { with: { type: "json5" } })).default;
  const unit = (await import(paths.settings, { with: { type: "json5" } })).default;
  const merged = [base, unit];
  // a MISSING over file is an EMPTY layer (a fresh /state volume boots
  // clean); a PRESENT but malformed one still fails loud at parse
  if (paths.over !== undefined && existsSync(paths.over))
    merged.push((await import(paths.over, { with: { type: "json5" } })).default);
  return merged.reduce((acc, layer) => mergeSettings(acc, layer));
}

/** unreadable-token paths are logged ONCE each (per-request reads must
 *  not spam the log); an operator bug becomes a visible line, and the
 *  caller treats the token as absent — the engine/peer gate simply
 *  stays open where the operator wanted a key */
const tokenLogged = new Set<string>();

/** read a key/token file (secrets are paths, never values); the ONE
 *  token read in src/ — null = absent/unreadable, fault logged once */
export function readToken(file: string): string | null {
  try {
    return readFileSync(file, "utf8").trim();
  } catch (e) {
    if (!tokenLogged.has(file)) {
      tokenLogged.add(file);
      logFault("settings.token", file, classifyFault(e));
    }
    return null;
  }
}

/** list a directory (the principals key dir); null = unreadable,
 *  fault logged once — auth fails CLOSED on top of it */
const dirLogged = new Set<string>();

export function listDir(dir: string): string[] | null {
  try {
    return readdirSync(dir);
  } catch (e) {
    if (!dirLogged.has(dir)) {
      dirLogged.add(dir);
      logFault("settings.listDir", dir, classifyFault(e));
    }
    return null;
  }
}
