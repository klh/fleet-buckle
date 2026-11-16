// worker.prefer.ts — the model picker: the worker self-picks its model
// from an ordered allow-list in fleet .prefer syntax (the same dotfile
// vocabulary exec-chain walks: must= / prefer= / can= / hub-url= /
// hub= / tag= / color=). Owner rulings 2026-11-16:
//   • a typical file carries hub-url= + prefer=; comma lists are tried
//     IN LISTING ORDER (first that WORKS wins)
//   • prefer= exhaustion falls through to the baked-in DEFAULTS ladder
//   • must= exhaustion is fatal — the worker errors out, never guesses
//   • NO limits by default: max-tokens / max-loops knobs exist, but
//     absence or 0 means unlimited (the seat 422 root cause is solved
//     by PICKING a model that fits, not by capping asks)
import { z } from "zod";
import { env } from "./worker.env.ts";
import type { Prober } from "./worker.probe.ts";

/** the parsed .prefer file — TYPE LAW: schema first, type derived */
export const PreferSchema = z.object({
  must: z.array(z.string()),
  prefer: z.array(z.string()),
  can: z.array(z.string()),
  /** ordered candidate hubs (http(s) only — bare labels park in hubLabels) */
  hubUrls: z.array(z.string()),
  /** hub= LABELS identify WHICH BUCKLE (resolved via the seed dir's
   * hubs.json — e.g. hub=ikea pins to the azure buckle) */
  hubLabels: z.array(z.string()),
  /** provider= identifies WHICH PROVIDER on that buckle (a buckle
   * fronts several — its /v1/models rows carry origin.label per
   * model; the ladder is scoped to that provider's rows) */
  provider: z.string(),
  tag: z.string(),
  color: z.string(),
  /** 0 = unlimited (the default — owner ruling) */
  maxTokens: z.number(),
  /** 0 = unlimited (the default — owner ruling) */
  maxLoops: z.number(),
});
export type Prefer = z.infer<typeof PreferSchema>;

/** the winning pick — carried into every ask() (schema first) */
export const PickSchema = z.object({
  model: z.string(),
  hub: z.string(),
  /** the hub identity that resolved (hubs.json label, or "env") */
  hubLabel: z.string(),
  /** the provider scope the ladder walked ("" = every provider) */
  provider: z.string(),
  tier: z.enum(["must", "prefer", "can", "default"]),
  /** 0 = unlimited (passed through from the prefer file) */
  maxTokens: z.number(),
  /** seed-file identification, surfaced to the seed render vars */
  tag: z.string().optional(),
  color: z.string().optional(),
});
export type Pick = z.infer<typeof PickSchema>;

/** the baked-in ladder prefer= exhaustion falls through to */
export const DEFAULT_MODELS: readonly string[] = [
  "gpt-5.3-codex",
  "claude-sonnet-5.5",
  "gpt-6-luna",
  "gpt-6.1-sol",
];

export type { Prober };

const splitList = (raw: string): string[] =>
  raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.length > 0);

const routeHubToken = (p: Prefer, token: string): void => {
  if (/^https?:\/\/\S+$/u.test(token)) p.hubUrls.push(token);
  else p.hubLabels.push(token);
};

/** key → how one `key=value` line mutates the accumulator */
const HANDLERS: Record<string, (p: Prefer, value: string) => void> = {
  must: (p, v) => p.must.push(...splitList(v)),
  prefer: (p, v) => p.prefer.push(...splitList(v)),
  can: (p, v) => p.can.push(...splitList(v)),
  huburl: (p, v) => splitList(v).forEach((t) => routeHubToken(p, t)),
  hub: (p, v) => splitList(v).forEach((t) => routeHubToken(p, t)),
  provider: (p, v) => {
    p.provider = v.toLowerCase();
  },
  tag: (p, v) => {
    p.tag = v;
  },
  color: (p, v) => {
    p.color = v;
  },
  maxtokens: (p, v) => {
    p.maxTokens = Number(v) || 0;
  },
  maxloops: (p, v) => {
    p.maxLoops = Number(v) || 0;
  },
};

const emptyPrefer = (): Prefer => ({
  must: [],
  prefer: [],
  can: [],
  hubUrls: [],
  hubLabels: [],
  provider: "",
  tag: "",
  color: "",
  maxTokens: 0,
  maxLoops: 0,
});

/** parse .prefer text: `key=value` lines, `#` comments, later lines append */
export const parsePrefer = (text: string): Prefer => {
  const p = emptyPrefer();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase().replace(/[-_]/g, "");
    const value = line.slice(eq + 1).trim();
    const handler = HANDLERS[key];
    if (value !== "" && handler) handler(p, value);
  }
  return PreferSchema.parse(p);
};

/** hubs.json — the seed dir's label → ordered candidate URLs map (the
 * fleet's hubs.json pattern, mounted per deployment): `hub=mscopilot`
 * in .prefer resolves THROUGH this map. Schema law: one parse face. */
export const HubsSchema = z.record(z.string(), z.array(z.string().url()));
export type Hubs = z.infer<typeof HubsSchema>;

/** a resolved hub: the URL every leg rides + the identity that
 * picked it (the hub LABEL when a hubs.json row won, else "env") */
export const HubResolutionSchema = z.object({ url: z.string(), label: z.string() });
export type HubResolution = z.infer<typeof HubResolutionSchema>;

/**
 * resolve the hub: `hub=` LABELS first (through the seed dir's
 * hubs.json map — how azure pins its buckle by identity: hub=ikea),
 * then hub-url= candidates, then the env buckle; first one
 * answering GET /v1/models wins. Unknown labels are dropped (a
 * label without a map row is config drift, not a hub). If none
 * answer we still return the env buckle — the model probe makes
 * the final call.
 */
export const pickHub = async (p: Prefer, hubs: Hubs = {}): Promise<HubResolution> => {
  // normalize: no trailing slash — `${hub}/v1/models` stays a clean path
  const clean = (url: string): string => url.replace(/\/+$/u, "");
  const labeled = p.hubLabels.flatMap((label) =>
    (hubs[label] ?? []).map((url) => ({ url: clean(url), label })),
  );
  const byUrl = p.hubUrls.map((url) => ({ url: clean(url), label: "hub-url" }));
  const candidates = [...labeled, ...byUrl, { url: env.buckle, label: "env" }].filter(
    (x, i, all) => x.url !== "" && all.findIndex((y) => y.url === x.url) === i,
  );
  for (const candidate of candidates) {
    const r = await fetch(`${candidate.url}/v1/models`, {
      headers: { authorization: `Bearer ${env.buckleKey}` },
      signal: AbortSignal.timeout(10_000),
    }).catch((_e: unknown) => null);
    if (r?.ok) return HubResolutionSchema.parse(candidate);
  }
  return HubResolutionSchema.parse({ url: env.buckle, label: "env" });
};

const probeTier = async (
  tier: Pick["tier"],
  models: readonly string[],
  hub: HubResolution,
  maxTokens: number,
  probe: Prober,
  catalog: ReadonlyMap<string, string>,
  p: Prefer,
): Promise<Pick | undefined> => {
  for (const model of models) {
    // case law: the token is lowercase; requests use the catalog's
    // ORIGINAL casing (unresolved tokens pass through verbatim)
    const asked = catalog.get(model) ?? model;
    if (await probe(hub.url, asked, maxTokens))
      return {
        model: asked,
        hub: hub.url,
        hubLabel: hub.label,
        provider: p.provider,
        tier,
        maxTokens,
        tag: p.tag,
        color: p.color,
      };
  }
  return undefined;
};

/**
 * walk the ladder: must → prefer → can → DEFAULTS; first probe win
 * takes the seat. must exhaustion is FATAL (throw); everything below
 * it falls through; total exhaustion is fatal too. The provider=
 * scope rides every Pick and names itself in the fault when set.
 */
export const pickModel = async (
  p: Prefer,
  hub: HubResolution,
  probe: Prober,
  catalog: ReadonlyMap<string, string>,
): Promise<Pick> => {
  const scope = p.provider === "" ? "" : ` (provider=${p.provider})`;
  const tiers: Array<[Pick["tier"], readonly string[]]> = [
    ["must", p.must],
    ["prefer", p.prefer],
    ["can", p.can],
    ["default", DEFAULT_MODELS.map((m) => m.toLowerCase())],
  ];
  for (const [tier, models] of tiers) {
    const pick = await probeTier(tier, models, hub, p.maxTokens, probe, catalog, p);
    if (pick) return pick;
    if (tier === "must" && p.must.length > 0)
      throw new Error(
        `prefer: must list exhausted without a working model${scope}: ${p.must.join(",")}`,
      );
  }
  throw new Error(
    `prefer: no model passed the probe (prefer + can + defaults all failed)${scope} on hub=${hub.label}`,
  );
};
