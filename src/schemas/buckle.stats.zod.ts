// buckle.stats.zod.ts — the live overview, PER HUB (one snapshot per
// buckle): where work happens (inflight/requests/tokens per model),
// WHO is connected (sessions = principal rows; kind-split, longest
// running, top token use), and the fleet ROLLUP the stats face folds
// over self + peers. Served by /v1/stats.
import { z } from "zod";
import { BucklePrincipalKind } from "./buckle.principal.zod.ts";

/** one model's live row — active = requests > 0 or inflight > 0 */
export const BuckleStatModelRow = z
  .object({
    model: z.string().min(1),
    inflight: z.number().int().min(0),
    requests: z.number().int().min(0),
    tokens: z.number().int().min(0),
    tps: z.number().min(0),
  })
  .strict();

/** one session's live row — a principal's row lives from its first
 *  open until the unit restarts; connected_since = session start */
export const BuckleStatPrincipalRow = z
  .object({
    principal: z.string().min(1),
    kind: BucklePrincipalKind.optional(),
    inflight: z.number().int().min(0),
    requests: z.number().int().min(0),
    tokens: z.number().int().min(0),
    connected_since: z.number().int().min(0),
    last_seen: z.number().int().min(0),
  })
  .strict();

/** a hub's top token consumer (a session) */
export const BuckleStatTokenTop = z
  .object({
    principal: z.string().min(1),
    kind: BucklePrincipalKind.optional(),
    requests: z.number().int().min(0),
    tokens: z.number().int().min(0),
  })
  .strict();

/** the sessions aggregate — kind-split counts, the longest running
 *  session, and the top token consumers (top 5) */
export const BuckleStatSessions = z
  .object({
    by_kind: z.record(z.string(), z.number().int().min(0)),
    longest_running_s: z.number().min(0),
    top_tokens: z.array(BuckleStatTokenTop),
  })
  .strict();

/** the engine's OWN telemetry surfaced in our snapshot: litellm
 *  counts requests/latency/spend — we surface, never re-count */
export const BuckleEngineTelemetry = z
  .object({
    reachable: z.boolean(),
    scraped_at: z.number().int().min(0),
    /** the engine's Prometheus SCALARS, name (with labels) → value —
     *  surfaced verbatim, capped; histograms ride their _sum/_count */
    series: z.record(z.string(), z.number()),
    /** the spend endpoints' answer: total + budget + per-model rows
     *  (absent sections surface null/empty, never guessed) */
    spend: z
      .object({
        total: z.number().min(0).nullable(),
        max_budget: z.number().min(0).nullable(),
        by_model: z.array(
          z.object({ model: z.string().min(1), spend: z.number().min(0) }).strict(),
        ),
      })
      .strict(),
  })
  .strict();
export type BuckleEngineTelemetry = z.output<typeof BuckleEngineTelemetry>;

export const BuckleStatsSnapshot = z
  .object({
    hub: z.string().min(1),
    models: z.array(BuckleStatModelRow),
    active_models: z.number().int().min(0),
    current_connections: z.number().int().min(0),
    tps: z.number().min(0),
    principals: z.array(BuckleStatPrincipalRow),
    sessions: BuckleStatSessions,
    /** present whenever the unit declares an engine (relay-only
     *  units omit it) — collected on the stats cache window */
    engine: BuckleEngineTelemetry.optional(),
  })
  .strict();
export type BuckleStatsSnapshot = z.output<typeof BuckleStatsSnapshot>;

/** the fleet rollup — self + every reachable peer folded (each hub
 *  counted ONCE via its own snapshot; distinct models unioned) */
export const BuckleStatsRollup = z
  .object({
    hubs: z.number().int().min(0),
    tps: z.number().min(0),
    current_connections: z.number().int().min(0),
    active_models: z.number().int().min(0),
    sessions: z
      .object({
        users: z.number().int().min(0),
        agents: z.number().int().min(0),
        services: z.number().int().min(0),
      })
      .strict(),
    longest_running_s: z.number().min(0),
    /** the fleet's top token consumers (top 5), hub-labelled */
    top_tokens: z.array(
      z
        .object({
          hub: z.string().min(1),
          principal: z.string().min(1),
          kind: BucklePrincipalKind.optional(),
          tokens: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();
export type BuckleStatsRollup = z.output<typeof BuckleStatsRollup>;

/** The federated response: ours + every downstream peer's snapshot,
 *  plus the rollup folded over the reachable ones. */
export const BuckleStatsResponse = z
  .object({
    self: BuckleStatsSnapshot,
    peers: z.record(z.string(), BuckleStatsSnapshot.nullable()),
    rollup: BuckleStatsRollup,
  })
  .strict();
export type BuckleStatsResponse = z.output<typeof BuckleStatsResponse>;

// ── B06 read model: request/attempt/spend receipts joined ──────────
/** the ONLY metric label names the exposition may carry — bounded;
 *  never prompt content, never runner ids / request ids */
export const BUCKLE_METRIC_LABELS = ["model", "provider", "outcome", "cost_state"] as const;

/** W14 correlation — rides rows/traces, NEVER metric labels */
export const BuckleCorrelation = z
  .object({
    runner_uuid: z.string().uuid(),
    writer_epoch: z.number().int().min(0),
    conversation: z.string().min(1),
    submission: z.string().min(1),
    request_id: z.string().min(1),
    traceparent: z.string().regex(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/),
    call_id: z.string().min(1),
  })
  .strict();
export type BuckleCorrelation = z.output<typeof BuckleCorrelation>;

/** cost honesty: unknown is null + a named state, never 0 */
export const BuckleCostState = z.enum(["priced", "missing_price", "spend_lag", "unknown"]);
export type BuckleCostState = z.output<typeof BuckleCostState>;

export const BuckleSpendJoinRow = z
  .object({
    correlation: BuckleCorrelation,
    model: z.string().min(1),
    provider: z.string().min(1).nullable(),
    outcome: z.enum(["ok", "error", "unknown"]),
    attempts: z.number().int().min(1),
    prompt_tokens: z.number().int().min(0).nullable(),
    completion_tokens: z.number().int().min(0).nullable(),
    cost_usd: z.number().min(0).nullable(),
    cost_state: BuckleCostState,
  })
  .strict();
export type BuckleSpendJoinRow = z.output<typeof BuckleSpendJoinRow>;

export const BuckleReadModel = z
  .object({
    schema_version: z.literal(1),
    generated_at: z.number().int().min(0),
    collector: z
      .object({
        state: z.enum(["up", "outage"]),
        last_success_at: z.number().int().min(0).nullable(),
      })
      .strict(),
    slo: z
      .object({
        scrape_freshness_s: z.number().int().min(1),
        spend_lag_budget_s: z.number().int().min(1),
        join_completeness_target: z.number().min(0).max(1),
      })
      .strict(),
    retention: z
      .object({
        rows_days: z.number().int().min(1),
        aggregates_days: z.number().int().min(1),
      })
      .strict(),
    rows: z.array(BuckleSpendJoinRow),
  })
  .strict();
export type BuckleReadModel = z.output<typeof BuckleReadModel>;
