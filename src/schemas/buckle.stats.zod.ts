// buckle.stats.zod.ts — the live overview: where work is taking place
// (inflight + tok/s per model), and WHO is connected (principals with
// machines, per buckle). Served by /stats and folded into the tree.
import { z } from "zod";

export const BuckleStatModelRow = z
  .object({
    model: z.string().min(1),
    inflight: z.number().int().min(0),
    tps: z.number().min(0),
  })
  .strict();

export const BuckleStatPrincipalRow = z
  .object({
    principal: z.string().min(1),
    kind: z.enum(["human", "developer", "agent", "service"]).optional(),
    machine: z.string().optional(),
    inflight: z.number().int().min(0),
    requests: z.number().int().min(0),
    connected_since: z.number().int().min(0),
    last_seen: z.number().int().min(0),
  })
  .strict();

export const BuckleStatsSnapshot = z
  .object({
    hub: z.string().min(1),
    models: z.array(BuckleStatModelRow),
    current_connections: z.number().int().min(0),
    tps: z.number().min(0),
    principals: z.array(BuckleStatPrincipalRow),
  })
  .strict();
export type BuckleStatsSnapshot = z.output<typeof BuckleStatsSnapshot>;

/** The federated response: ours + every downstream peer's snapshot. */
export const BuckleStatsResponse = z
  .object({
    self: BuckleStatsSnapshot,
    peers: z.record(z.string(), BuckleStatsSnapshot.nullable()),
  })
  .strict();
export type BuckleStatsResponse = z.output<typeof BuckleStatsResponse>;
