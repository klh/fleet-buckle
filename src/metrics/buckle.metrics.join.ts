// metrics/buckle.metrics.join.ts — join request/attempt/spend
// receipts into the versioned read model. Unknown stays null.
import {
  BUCKLE_METRIC_LABELS,
  BuckleReadModel,
  type BuckleCorrelation,
  type BuckleCostState,
  type BuckleSpendJoinRow,
} from "../schemas/buckle.stats.zod.ts";

export interface RequestReceipt {
  correlation: BuckleCorrelation;
  model: string;
  provider?: string | null;
  ok?: boolean | null;
  attempts: number;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
}
/** spend receipt: cost undefined/null = engine has no price */
export interface SpendReceipt {
  request_id: string;
  cost_usd?: number | null;
  priced?: boolean;
}

export const DEFAULT_SLO = { scrape_freshness_s: 60, spend_lag_budget_s: 300, join_completeness_target: 0.99 };
export const DEFAULT_RETENTION = { rows_days: 30, aggregates_days: 400 };

function costOf(r: SpendReceipt | undefined): { cost: number | null; state: BuckleCostState } {
  if (r === undefined) return { cost: null, state: "spend_lag" };
  if (r.priced === false) return { cost: null, state: "missing_price" };
  if (r.cost_usd === null || r.cost_usd === undefined) return { cost: null, state: "unknown" };
  return { cost: r.cost_usd, state: "priced" };
}

export function joinReceipts(input: {
  requests: RequestReceipt[];
  spend: SpendReceipt[];
  now: number;
  /** null = collector never succeeded */
  lastSuccessAt: number | null;
  outage: boolean;
}): BuckleReadModel {
  const spendBy = new Map(input.spend.map((s) => [s.request_id, s]));
  const rows: BuckleSpendJoinRow[] = input.requests.map((q) => {
    const { cost, state } = costOf(spendBy.get(q.correlation.request_id));
    return {
      correlation: q.correlation,
      model: q.model,
      provider: q.provider ?? null,
      outcome: q.ok === true ? "ok" : q.ok === false ? "error" : "unknown",
      attempts: q.attempts,
      prompt_tokens: q.prompt_tokens ?? null,
      completion_tokens: q.completion_tokens ?? null,
      cost_usd: cost,
      cost_state: state,
    };
  });
  return BuckleReadModel.parse({
    schema_version: 1,
    generated_at: input.now,
    collector: { state: input.outage ? "outage" : "up", last_success_at: input.lastSuccessAt },
    slo: DEFAULT_SLO,
    retention: DEFAULT_RETENTION,
    rows,
  });
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

/** bounded-label exposition: counts per (model,provider,outcome,cost_state) only */
export function exposeReadModel(m: BuckleReadModel): string {
  const counts = new Map<string, number>();
  for (const r of m.rows) {
    const labels: Record<(typeof BUCKLE_METRIC_LABELS)[number], string> = {
      model: r.model,
      provider: r.provider ?? "unknown",
      outcome: r.outcome,
      cost_state: r.cost_state,
    };
    const k = BUCKLE_METRIC_LABELS.map((n) => `${n}="${esc(labels[n])}"`).join(",");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const lines = ["# TYPE buckle_requests_joined gauge"];
  for (const [k, v] of counts) lines.push(`buckle_requests_joined{${k}} ${v}`);
  lines.push("# TYPE buckle_collector_up gauge", `buckle_collector_up ${m.collector.state === "up" ? 1 : 0}`);
  return lines.join("\n") + "\n";
}
