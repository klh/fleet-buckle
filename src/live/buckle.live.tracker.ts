// live/buckle.live.tracker.ts — the live overview state machine: per-model
// inflight + token throughput (rolling window), per-principal
// requests/inflight/last_seen. The proxy pipeline opens/closes around
// each forwarded chat; /v1/stats renders the snapshot (the peers fold
// lives in buckle.live.stats.ts — one job per file). TYPE LAW: the
// principal kind is the SCHEMA's enum (buckle.principal.zod) — never
// an inline union, never a cast; rows here are typed by it.
import { z } from "zod";
import { BucklePrincipalKind } from "../schemas/buckle.principal.zod.ts";
import type { BuckleStatsSnapshot } from "../schemas/buckle.stats.zod.ts";
import { pick } from "../pick.ts";

/** tokens-per-second rides a 10s rolling window (definitional, not a
 *  tunable — the window IS what "current tps" means here) */
const TPS_WINDOW_MS = 10_000;

export type LiveTracker = ReturnType<typeof createLive>;

/** the tracked row — kind optional (a principal may open before its
 *  registry row is looked at), everything else always-known.
 *  zod-derived (the type law) */
export const TrackedPrincipalState = z
  .object({
    inflight: z.number().int().min(0),
    requests: z.number().int().min(0),
    connected_since: z.number().int().min(0),
    last_seen: z.number().int().min(0),
    kind: BucklePrincipalKind.optional(),
  })
  .strict();
type TrackedPrincipal = z.output<typeof TrackedPrincipalState>;

export function createLive(hub: string) {
  const models = new Map<string, { inflight: number }>();
  const principals = new Map<string, TrackedPrincipal>();
  const tokenEvents: { at: number; tokens: number }[] = [];

  const principalRow = (id: string, kind?: BucklePrincipalKind): TrackedPrincipal => {
    let row = principals.get(id);
    if (row === undefined) {
      row = { inflight: 0, requests: 0, connected_since: Date.now(), last_seen: 0 };
      if (kind !== undefined) row.kind = kind;
      principals.set(id, row);
    }
    return row;
  };

  return {
    /** the forward loop opens a hop: inflight on model + principal. */
    open(principal: string, kind: BucklePrincipalKind | undefined, model: string): void {
      const m = models.get(model) ?? { inflight: 0 };
      m.inflight += 1;
      models.set(model, m);
      principalRow(principal, kind).inflight += 1;
    },
    /** the hop closes: usage tokens counted, requests bumped. */
    close(principal: string, model: string, tokens: number): void {
      const m = models.get(model);
      if (m !== undefined && m.inflight > 0) m.inflight -= 1;
      const p = principals.get(principal);
      if (p !== undefined) {
        if (p.inflight > 0) p.inflight -= 1;
        p.requests += 1;
        p.last_seen = Date.now();
      }
      if (tokens > 0) tokenEvents.push({ at: Date.now(), tokens });
    },
    snapshot(): BuckleStatsSnapshot {
      const now = Date.now();
      let windowTokens = 0;
      for (const e of tokenEvents)
        if (now - e.at <= TPS_WINDOW_MS) windowTokens += e.tokens;
      return {
        hub,
        models: [...models.entries()].map(([model, m]) => ({
          model,
          inflight: m.inflight,
          tps: windowTokens / (TPS_WINDOW_MS / 1000),
        })),
        current_connections: principals.size,
        tps: windowTokens / (TPS_WINDOW_MS / 1000),
        principals: [...principals.entries()].map(([principal, p]) => ({
          principal,
          ...pick("kind", p.kind),
          inflight: p.inflight,
          requests: p.requests,
          connected_since: p.connected_since,
          last_seen: p.last_seen,
        })),
      };
    },
  };
}
