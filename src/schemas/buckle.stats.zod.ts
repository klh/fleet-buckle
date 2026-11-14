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

export const BuckleStatsSnapshot = z
  .object({
    hub: z.string().min(1),
    models: z.array(BuckleStatModelRow),
    active_models: z.number().int().min(0),
    current_connections: z.number().int().min(0),
    tps: z.number().min(0),
    principals: z.array(BuckleStatPrincipalRow),
    sessions: BuckleStatSessions,
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
