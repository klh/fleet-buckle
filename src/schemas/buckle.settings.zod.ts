// buckle.settings.zod.ts — THE settings file: strictly JSON5, secrets are
// PATHS, models are FETCHED (settings carry overrides only). The file a
// buckle runs is default.settings.json5 ⊕ <buckle>.settings.json5,
// deep-merged, then safeParse'd here — fail loud, never limp along.
import { z } from "zod";
import { BuckleAccessRegistry } from "./buckle.access.zod.ts";
import {
  KNOWN_PROVIDERS,
  ProviderDialect,
  type KnownProviderLabel,
} from "./buckle.provider.registry.zod.ts";
import { ChatRouteSchema } from "./buckle.route.zod.ts";

/** A path to a 0600 secret file. The value never rides any artifact. */
export const KeyPath = z.string().min(1);
export type KeyPath = z.output<typeof KeyPath>;

/** per-model OVERRIDES only (law c.1: the model list itself is FETCHED,
 *  settings carry overrides) — model id → override field → value */
const ModelOverrides = z.record(z.string(), z.record(z.string(), z.unknown()));

/** Connection caps. Resolution: model > provider > hub, per field. */
// composed from the ONE caps schema — imported here, re-exported for
// settings readers (never re-declared)
import { BuckleLimits } from "./buckle.limits.zod.ts";
export { BuckleLimits };

/** A provider entry as WRITTEN: url/dialect optional — the registry
 *  of recognized providers supplies real defaults (an unknown label
 *  without an explicit url fails loud at parse). */
export const BuckleProviderEntry = z
  .object({
    url: z.url().optional(),
    dialect: ProviderDialect.optional(),
    key: KeyPath.optional(),
    limits: BuckleLimits.optional(),
    /** c.1 — per-model OVERRIDES only; the list itself is fetched. */
    models: ModelOverrides.optional(),
    /** BYOC (bring-your-own-credential): the CALLER's /w/ token is
     *  the upstream credential — no key file ever exists for this
     *  provider on this unit. True by registry default for seats
     *  that only ever ride user tokens (the Copilot seat). */
    user_token: z.boolean().optional(),
  })
  .strict();
export type BuckleProviderEntry = z.output<typeof BuckleProviderEntry>;

/** A provider this buckle fronts (c), RESOLVED against the registry:
 *  url and dialect always concrete. Keys are paths (c.2). */
export const BuckleProvider = z
  .object({
    url: z.url(),
    dialect: ProviderDialect,
    key: KeyPath.optional(),
    limits: BuckleLimits.optional(),
    /** c.1 — per-model OVERRIDES only; the list itself is fetched. */
    models: ModelOverrides.optional(),
    /** resolved BYOC flag: entry row ⊕ registry default, always concrete */
    user_token: z.boolean(),
  })
  .strict();
export type BuckleProvider = z.output<typeof BuckleProvider>;

/** providers as configured: every entry resolves url/dialect from the
 *  registry of recognized providers unless the file overrides. */
export const BuckleProviders = z
  .record(z.string(), BuckleProviderEntry)
  .transform((entries, ctx) => {
    const resolved: Record<string, BuckleProvider> = {};
    for (const [label, entry] of Object.entries(entries)) {
      const known = KNOWN_PROVIDERS[label as KnownProviderLabel];
      // fail loud as a PARSE issue (never a thrown exception through
      // safeParse): unknown label without explicit url/dialect
      if (entry.url === undefined && known === undefined)
        ctx.addIssue({
          code: "custom",
          path: [label, "url"],
          message: `provider "${label}" is not recognized — give it an explicit url or use one of: ${Object.keys(KNOWN_PROVIDERS).join(", ")}`,
        });
      if (entry.dialect === undefined && known === undefined)
        ctx.addIssue({
          code: "custom",
          path: [label, "dialect"],
          message: `provider "${label}" is not recognized — set dialect explicitly`,
        });
      const url = entry.url ?? known?.url;
      const dialect = entry.dialect ?? known?.dialect;
      if (url === undefined || dialect === undefined) continue;
      resolved[label] = {
        ...entry,
        url,
        dialect,
        // the registry's user_token default is a TABULA-RASA default:
        // it applies only when the entry configures NO unit key (BYOC
        // = no unit key ever exists). A keyed provider stays CLASSIC
        // unless the entry EXPLICITLY says user_token: true.
        user_token:
          entry.user_token ?? (entry.key === undefined ? (known?.user_token ?? false) : false),
      };
    }
    return resolved;
  });

/** A DOWNSTREAM peer buckle (d). We pull its catalog; we never call up.
 *  token_file authenticates our pulls against that peer (d.1). */
export const BucklePeer = z
  .object({
    url: z.url(),
    token_file: KeyPath.optional(),
    limits: BuckleLimits.optional(),
    models: ModelOverrides.optional(),
  })
  .strict();
export type BucklePeer = z.output<typeof BucklePeer>;

/** MITM law: blocks injected into matching requests at ingress —
 *  decided by the ONE judge callback (context/buckle.context.judge),
 *  whose shipped form consumes exactly this policy. Every declared
 *  dimension must match (AND); a stanza is text XOR file (files are
 *  read ONCE at boot — fail loud on unreadable). */
/** the MATCH half — every dimension optional (AND semantics; an
 *  absent `match` is the deliberate catch-all). Dimensions may only
 *  name facts the judge actually receives (ContextFacts). */
const ContextMatch = z
  .object({
    /** exact principal id */
    principal: z.string().min(1).optional(),
    /** a principal GROUP the caller must carry */
    group: z.string().min(1).optional(),
    /** the ingress dialect this rule fires on (chat | messages) */
    route: ChatRouteSchema.optional(),
    /** model group filters: exact or prefix */
    models: z.array(z.string().min(1)).optional(),
    /** a substring the BODY START must carry */
    bodyContains: z.string().min(1).optional(),
    /** the fleet CLI hook's repo stamp (x-fleet-repo) */
    repo: z.string().min(1).optional(),
    /** the lane label (x-fleet-lane) */
    lane: z.string().min(1).optional(),
    /** the work item id (x-fleet-work) */
    work: z.string().min(1).optional(),
  })
  .strict();

/** one rule: a stanza (text XOR file — files read ONCE at boot) +
 *  the match that fires it. The id is the observability label (the
 *  injection counter + the never-silent response header). */
export const BuckleContextRule = z.union([
  z
    .object({ id: z.string().min(1), match: ContextMatch.optional(), file: z.string().min(1) })
    .strict(),
  z
    .object({ id: z.string().min(1), match: ContextMatch.optional(), text: z.string().min(1) })
    .strict(),
]);
export const BuckleContextPolicy = z.object({ rules: z.array(BuckleContextRule).min(1) }).strict();
export type BuckleContextRule = z.output<typeof BuckleContextRule>;
export type BuckleContextPolicy = z.output<typeof BuckleContextPolicy>;

/** a LANE row — the /w/<slug> launch URL's target: the slug pins the
 *  MODEL (the pin wins over the body; the hub falls out of the
 *  federated catalog — a peer-origin model rides the hop). The
 *  simple URL agents/skills/MCP CLIs launch on. */
export const BuckleLane = z.object({ id: z.string().min(1), model: z.string().min(1) }).strict();
export const BuckleLaneTable = z.array(BuckleLane);
export type BuckleLane = z.output<typeof BuckleLane>;

/** One buckle's settings — the merged file content. */
export const BuckleSettings = z
  .object({
    version: z.literal(1).default(1),
    hub: z
      .object({
        label: z.string().min(1),
        // optional version stamp — the rolling-deploy marker: a new
        // buckle answers /healthz with its version before traffic flips
        version: z.string().min(1).optional(),
        url: z.url().optional(),
        ports: z
          .object({
            buckle: z.number().int().min(1).max(65535).default(4111),
            ready: z.number().int().min(1).max(65535).default(4114),
          })
          .strict()
          .prefault({}),
        allow_cloud: z.boolean().optional(),
        ready_model: z.string().min(1).optional(),
      })
      .strict(),
    /** a — generalized caps for the whole hub. */
    limits: BuckleLimits.optional(),
    context_policy: BuckleContextPolicy.optional(),
    /** the /w/<slug> launch table: slug pins the model (the pin wins
     *  over the body; the hub falls out of the federated catalog).
     *  FROZEN SCOPE: admission/authz stay here ONLY until the
     *  litellm-auth collapse lands (docs/target-architecture.md) —
     *  new principal/budget/surface kinds stop at this line. */
    lanes: BuckleLaneTable.optional(),
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
    /** the unit's litellm engine — the forward target of the MITM
     *  loop. ONE home: this url (no env override exists); the VALUE
     *  defaults in deploy/settings/default.settings.json5, never here.
     *  Optional: a relay-only unit (pure federation hop) has none.
     *  metrics_url: litellm serves Prometheus on a SEPARATE process
     *  (--prometheus_metrics_port); absent = scrape the engine url
     *  itself (engines without the face answer empty, never throw) */
    engine: z.object({ url: z.url(), metrics_url: z.url().optional() }).strict().optional(),
    /** per-buckle access registry (this buckle's OWN "AD domain"). */
    access: BuckleAccessRegistry.optional(),
    /** c — providers configured on this hub (registry-resolved). */
    providers: BuckleProviders.optional(),
    /** d — downstream peers. */
    hubs: z.record(z.string(), BucklePeer).optional(),
    /** e — every bounded wait + cache TTL. ONE home: the knobs that
     *  were once scattered constants live here, zod-defaulted so a
     *  parsed settings object is always complete. */
    timeouts: z
      .object({
        /** provider catalog pulls (upstream /models) */
        provider_fetch_ms: z.number().int().min(100).default(1500),
        /** downstream peer pulls (catalog/tree/stats faces) */
        peer_pull_ms: z.number().int().min(100).default(1500),
        /** the engine leg of the forward loop */
        engine_ms: z.number().int().min(1000).default(120_000),
        /** the hop leg (peer buckle chat forward) */
        hop_ms: z.number().int().min(1000).default(120_000),
        /** upstream catalog cache freshness */
        catalog_cache_ms: z.number().int().min(0).default(2000),
        /** federated stats fold freshness — peer snapshots are pulled
         *  at most this often; the own snapshot stays live */
        stats_cache_ms: z.number().int().min(0).default(2000),
      })
      .strict()
      .prefault({}),
    /** f — telemetry sinks. Absent url = export off (traces still
     *  flow on the wire headers). */
    telemetry: z.object({ otlp_url: z.url().optional() }).strict().prefault({}),
  })
  .strict();
export type BuckleSettings = z.output<typeof BuckleSettings>;

export const BuckleSettingsFile = z
  .object({ version: z.literal(1).default(1), hub: BuckleSettings.shape.hub })
  .strict();
export type BuckleSettingsFile = z.output<typeof BuckleSettingsFile>;

/** Deep-merge default ⊕ specific (objects merge, scalars/arrays replace),
 *  then parse. The ONE way settings load. */
export function mergeSettings(base: unknown, override: unknown): BuckleSettings {
  const merged = deepMerge(base, override);
  return BuckleSettings.parse(merged);
}

/** the non-throwing twin: drift decomposes to a detail string instead
 *  of an exception (callers outside the settings.ts catch budget turn
 *  a failed merge into a loud rejection, never a thrown one). */
export function mergeSettingsSafe(
  base: unknown,
  override: unknown,
): { ok: true; settings: BuckleSettings } | { ok: false; detail: string } {
  const merged = deepMerge(base, override);
  const parsed = BuckleSettings.safeParse(merged);
  return parsed.success
    ? { ok: true, settings: parsed.data }
    : { ok: false, detail: parsed.error.message };
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
