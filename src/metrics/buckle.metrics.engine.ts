// metrics/buckle.metrics.engine.ts — the ENGINE TELEMETRY collector:
// litellm already counts everything (requests, latency, spend) — we
// SURFACE it instead of re-counting. Pulls the engine's Prometheus
// /metrics scalars and the SPEND endpoints (/global/spend,
// /global/spend/models — budget tracking), all on ONE mem-cache
// window (settings.timeouts.stats_cache_ms, single-flight). A dead
// engine reports reachable:false — honest, never a throw; the faults
// log at the seam, named.
import { z } from "zod";
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { BuckleEngineTelemetry as EngineTelemetry } from "../schemas/buckle.stats.zod.ts";
import { bodyText, httpSend, parseJson } from "../fault.ts";
import type { TokenReader } from "../federation/buckle.federation.peer.ts";
import { createWindowCache } from "./buckle.metrics.window.ts";

const UNREACHABLE_TELEMETRY = {
  reachable: false,
  scraped_at: 0,
  series: {},
  spend: { total: null, max_budget: null, by_model: [] },
} as const;

/** one scalar prom-text sample line — `name{labels} value [ts]`;
 *  comments, blanks and non-numeric samples answer null */
function sampleOf(line: string): { key: string; value: number } | null {
  if (line.startsWith("#") || line.trim() === "") return null;
  const m = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*(?:\{[^}]*\})?)\s+(\S+)/);
  if (m === null) return null;
  const value = Number(m[2]);
  return Number.isFinite(value) ? { key: m[1]!, value } : null;
}

/** the /metrics fold: every sample that parses, capped */
function seriesOf(text: string, cap: number): Record<string, number> {
  const series: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const sample = sampleOf(line);
    if (sample !== null) series[sample.key] = sample.value;
    if (Object.keys(series).length >= cap) break;
  }
  return series;
}

/** the engine's spend-answer shapes, SCHEMA'd (external wire input —
 *  parsed, never hand-cast). /global/spend answers {spend,
 *  max_budget} — absence tolerated (older engines, keyless
 *  deployments): null, never a guess */
const SpendTotal = z
  .object({
    spend: z.number().finite().nonnegative().nullish(),
    max_budget: z.number().finite().nonnegative().nullish(),
  })
  .passthrough();

/** /global/spend/models answers [{model, total_spend|spend}...] (or
 *  {data:[...]}) — each row that parses rides, others drop */
const SpendRow = z
  .object({
    model: z.string().min(1),
    total_spend: z.number().finite().nonnegative().nullish(),
    spend: z.number().finite().nonnegative().nullish(),
  })
  .passthrough();
const SpendModels = z.union([
  z.array(SpendRow),
  z.object({ data: z.array(SpendRow) }).passthrough(),
]);

function spendTotalOf(json: unknown): { total: number | null; max_budget: number | null } {
  const row = SpendTotal.safeParse(json);
  if (!row.success) return { total: null, max_budget: null };
  return { total: row.data.spend ?? null, max_budget: row.data.max_budget ?? null };
}

function spendModelsOf(json: unknown): { model: string; spend: number }[] {
  const parsed = SpendModels.safeParse(json);
  if (!parsed.success) return [];
  const rows = Array.isArray(parsed.data) ? parsed.data : parsed.data.data;
  const out: { model: string; spend: number }[] = [];
  for (const row of rows) {
    const spend = row.total_spend ?? row.spend;
    if (spend !== null && spend !== undefined) out.push({ model: row.model, spend });
  }
  return out;
}

/** the API base (chat + spend faces) — null = no engine configured */
function apiBaseUrl(settings: BuckleSettings): string | null {
  return settings.engine === undefined ? null : settings.engine.url.replace(/\/$/, "");
}

/** the Prometheus base: the metrics process when its url is declared
 *  (litellm serves metrics on a SEPARATE port —
 *  --prometheus_metrics_port), the engine itself otherwise */
function metricsBaseUrl(settings: BuckleSettings): string | null {
  if (settings.engine === undefined) return null;
  return (settings.engine.metrics_url ?? settings.engine.url).replace(/\/$/, "");
}

/** one authenticated GET against an engine face (bearer only when
 *  the engine key is configured — the same gate the chat leg rides) */
async function engineGet(
  base: string,
  settings: BuckleSettings,
  tokenOf: TokenReader,
  path: string,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const token = settings.keys?.engine !== undefined ? tokenOf(settings.keys.engine) : null;
  const sent = await httpSend(
    `${base}${path}`,
    {
      method: "GET",
      headers: {
        ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
      },
    },
    settings.timeouts.peer_pull_ms,
  );
  if (!sent.ok) return { ok: false };
  const body = await bodyText(sent);
  return body.ok ? { ok: true, text: body.text } : { ok: false };
}

/** one endpoint's parsed JSON, or null when the pull failed (the
 *  empty fold — telemetry degrades per-section, never throws) */
async function engineJsonOf(
  base: string,
  settings: BuckleSettings,
  tokenOf: TokenReader,
  path: string,
): Promise<unknown> {
  const got = await engineGet(base, settings, tokenOf, path);
  if (!got.ok) return null;
  const json = parseJson(got.text);
  return json.ok ? json.data : null;
}

/** one pull = metrics + both spend endpoints; a dead /metrics is a
 *  dead engine (reachable:false); failing spend legs degrade to
 *  their empty sections — telemetry is best-effort, never a
 *  request-path concern */
async function pullTelemetry(
  settings: BuckleSettings,
  tokenOf: TokenReader,
): Promise<EngineTelemetry> {
  const api = apiBaseUrl(settings);
  const metricsBase = metricsBaseUrl(settings);
  if (api === null || metricsBase === null)
    return EngineTelemetry.parse({ ...UNREACHABLE_TELEMETRY, scraped_at: Date.now() });
  const metrics = await engineGet(metricsBase, settings, tokenOf, "/metrics");
  if (!metrics.ok)
    return EngineTelemetry.parse({ ...UNREACHABLE_TELEMETRY, scraped_at: Date.now() });
  const [spendJson, modelsJson] = [
    await engineJsonOf(api, settings, tokenOf, "/global/spend"),
    await engineJsonOf(api, settings, tokenOf, "/global/spend/models"),
  ];
  const totals = spendJson !== null ? spendTotalOf(spendJson) : { total: null, max_budget: null };
  return EngineTelemetry.parse({
    reachable: true,
    scraped_at: Date.now(),
    series: seriesOf(metrics.text, 500),
    spend: {
      total: totals.total,
      max_budget: totals.max_budget,
      by_model: modelsJson !== null ? spendModelsOf(modelsJson) : [],
    },
  });
}

/** the collector: one mem-cache window over the pull */
export type EngineTelemetrySource = ReturnType<typeof createEngineCollector>;

export function createEngineCollector(settings: BuckleSettings, tokenOf: TokenReader) {
  const window = createWindowCache(settings.timeouts.stats_cache_ms, () =>
    pullTelemetry(settings, tokenOf),
  );
  return { get: (): Promise<EngineTelemetry> => window.get() };
}
