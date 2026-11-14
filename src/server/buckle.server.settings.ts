// buckle.server.settings.ts — THE one way settings load: default ⊕
// buckle ⊕ over, JSON5 all (Bun imports it natively), deep-merged
// through mergeSettings, safeParse'd. The over layer is the mode
// switch: the SAME unit file serves real mode (no over — registry
// default endpoints) and stub mode (over injects stub urls). Paths
// come from flags > env; secrets are PATHS in the file itself, never
// values here.
import { z } from "zod";
import { mergeSettings, type BuckleSettings } from "../schemas/buckle.settings.zod.ts";

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
    flag("defaults") ??
    process.env["BUCKLE_DEFAULTS"] ??
    "deploy/settings/default.settings.json5";
  const settings =
    flag("settings") ??
    process.env["BUCKLE_SETTINGS"] ??
    "deploy/settings/b1.settings.json5";
  const over = flag("over") ?? process.env["BUCKLE_SETTINGS_OVER"];
  // absent (empty string) = no overlay: real mode rides the registry
  return over === undefined || over === ""
    ? { defaults, settings }
    : { defaults, settings, over };
}

export async function loadSettings(
  paths: SettingsPaths,
): Promise<BuckleSettings> {
  const [base, specific, over] = await Promise.all([
    import(paths.defaults, { with: { type: "json5" } }),
    import(paths.settings, { with: { type: "json5" } }),
    paths.over === undefined
      ? undefined
      : import(paths.over, { with: { type: "json5" } }),
  ]);
  const merged = mergeSettings(
    mergeSettings(base.default, specific.default),
    over?.default ?? {},
  );
  return merged; // mergeSettings parses — fail loud, never limp along
}
