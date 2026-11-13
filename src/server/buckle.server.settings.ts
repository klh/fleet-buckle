// buckle.server.settings.ts — THE one way settings load: default ⊕
// buckle, JSON5 both (Bun imports it natively), deep-merged through
// mergeSettings, safeParse'd. Paths come from flags > env; secrets are
// PATHS in the file itself, never values here.
import { z } from "zod";
import { mergeSettings, type BuckleSettings } from "../schemas/buckle.settings.zod.ts";

export const SettingsPathsSchema = z
  .object({ defaults: z.string().min(1), settings: z.string().min(1) })
  .strict();
export type SettingsPaths = z.output<typeof SettingsPathsSchema>;

export function resolveSettingsPaths(args: string[]): SettingsPaths {
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    defaults:
      flag("defaults") ??
      process.env["BUCKLE_DEFAULTS"] ??
      "deploy/settings/default.settings.json5",
    settings:
      flag("settings") ??
      process.env["BUCKLE_SETTINGS"] ??
      "deploy/settings/b1.settings.json5",
  };
}

export async function loadSettings(
  paths: SettingsPaths,
): Promise<BuckleSettings> {
  const [base, specific] = await Promise.all([
    import(paths.defaults, { with: { type: "json5" } }),
    import(paths.settings, { with: { type: "json5" } }),
  ]);
  const merged = mergeSettings(base.default, specific.default);
  return merged; // mergeSettings parses — fail loud, never limp along
}
