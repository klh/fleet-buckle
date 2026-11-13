// buckle.settings.zod.ts — THE settings file: strictly JSON5, secrets are
// PATHS, models are FETCHED (settings carry overrides only). The file a
// buckle runs is default.settings.json5 ⊕ <buckle>.settings.json5,
// deep-merged, then safeParse'd here — fail loud, never limp along.
import { z } from "zod";
import { BuckleAccessRegistry } from "./buckle.access.zod.ts";

/** A path to a 0600 secret file. The value never rides any artifact. */
export const KeyPath = z.string().min(1);
export type KeyPath = z.output<typeof KeyPath>;

/** Connection caps. Resolution: model > provider > hub, per field. */
export const BuckleLimits = z
  .object({
    max_concurrent: z.number().int().positive().optional(),
    max_per_ip: z.number().int().positive().optional(),
    max_rpm: z.number().int().positive().optional(),
  })
  .strict();
export type BuckleLimits = z.output<typeof BuckleLimits>;

/** A provider this buckle fronts (c). Keys are paths (c.2). */
export const BuckleProvider = z
  .object({
    url: z.url(),
    dialect: z.enum(["openai", "anthropic"]).optional(),
    key: KeyPath.optional(),
    limits: BuckleLimits.optional(),
    /** c.1 — per-model OVERRIDES only; the list itself is fetched. */
    models: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  })
  .strict();
export type BuckleProvider = z.output<typeof BuckleProvider>;

/** A DOWNSTREAM peer buckle (d). We pull its catalog; we never call up.
 *  token_file authenticates our pulls against that peer (d.1). */
export const BucklePeer = z
  .object({
    url: z.url(),
    token_file: KeyPath.optional(),
    limits: BuckleLimits.optional(),
    models: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  })
  .strict();
export type BucklePeer = z.output<typeof BucklePeer>;

/** MITM law: blocks injected into matching requests at ingress. */
export const BuckleContextPolicy = z
  .object({
    inject: z
      .array(
        z
          .object({
            file: z.string().min(1).optional(),
            text: z.string().optional(),
            /** Model group filters; absent = every model. */
            models: z.array(z.string().min(1)).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type BuckleContextPolicy = z.output<typeof BuckleContextPolicy>;

/** One buckle's settings — the merged file content. */
export const BuckleSettings = z
  .object({
    version: z.literal(1).default(1),
    hub: z
      .object({
        label: z.string().min(1),
        url: z.url().optional(),
        ports: z
          .object({
            buckle: z.number().int().min(1).max(65535).optional(),
            ready: z.number().int().min(1).max(65535).optional(),
          })
          .strict()
          .optional(),
        allow_cloud: z.boolean().optional(),
        ready_model: z.string().min(1).optional(),
      })
      .strict(),
    /** a — generalized caps for the whole hub. */
    limits: BuckleLimits.optional(),
    context_policy: BuckleContextPolicy.optional(),
    /** b — general security: key PATHS, never values. */
    keys: z
      .object({
        root: KeyPath.optional(),
        engine: KeyPath.optional(),
        /** dir of per-principal 0600 key files: principal.<id>.key */
        principals_dir: KeyPath.optional(),
      })
      .strict()
      .optional(),
    /** the unit's litellm engine — the forward target of the MITM loop. */
    engine: z
      .object({ url: z.url() })
      .strict()
      .optional(),
    /** per-buckle access registry (this buckle's OWN "AD domain"). */
    access: BuckleAccessRegistry.optional(),
    /** c — providers configured on this hub. */
    providers: z.record(z.string(), BuckleProvider).optional(),
    /** d — downstream peers. */
    hubs: z.record(z.string(), BucklePeer).optional(),
  })
  .strict();
export type BuckleSettings = z.output<typeof BuckleSettings>;

export const BuckleSettingsFile = z
  .object({ version: z.literal(1).default(1), hub: BuckleSettings.shape.hub })
  .strict();
export type BuckleSettingsFile = z.output<typeof BuckleSettingsFile>;

/** Deep-merge default ⊕ specific (objects merge, scalars/arrays replace),
 *  then parse. The ONE way settings load. */
export function mergeSettings(
  base: unknown,
  override: unknown,
): BuckleSettings {
  const merged = deepMerge(base, override);
  return BuckleSettings.parse(merged);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out;
}
