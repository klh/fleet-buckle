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

/** the tracker's whole state — one object, mutated only by the
 *  functions below (factory-typed, the live-values idiom) */
function createLiveState() {
  return {
    models: new Map<string, { inflight: number }>(),
    principals: new Map<string, TrackedPrincipal>(),
    tokenEvents: [] as { at: number; tokens: number }[],
  };
}
type LiveState = ReturnType<typeof createLiveState>;

/** the principal's row, lazily created (kind stamps only on creation) */
function principalRowOf(
  state: LiveState,
  id: string,
  kind: BucklePrincipalKind | undefined,
): TrackedPrincipal {
  let row = state.principals.get(id);
  if (row === undefined) {
    row = { inflight: 0, requests: 0, connected_since: Date.now(), last_seen: 0 };
    if (kind !== undefined) row.kind = kind;
    state.principals.set(id, row);
  }
  return row;
}

/** tokens banked inside the rolling window (pure fold) */
function windowTokensOf(
  events: { at: number; tokens: number }[],
  now: number,
): number {
  let tokens = 0;
  for (const e of events) if (now - e.at <= TPS_WINDOW_MS) tokens += e.tokens;
  return tokens;
}

/** the snapshot's model rows (pure map over the models state) */
function modelRowsOf(
  models: Map<string, { inflight: number }>,
  tps: number,
): BuckleStatsSnapshot["models"] {
  return [...models.entries()].map(([model, m]) => ({ model, inflight: m.inflight, tps }));
}

/** the snapshot's principal rows (pure map over the principals state) */
function principalRowsOf(
  principals: Map<string, TrackedPrincipal>,
): BuckleStatsSnapshot["principals"] {
  return [...principals.entries()].map(([principal, p]) => ({
    principal,
    ...pick("kind", p.kind),
    inflight: p.inflight,
    requests: p.requests,
    connected_since: p.connected_since,
    last_seen: p.last_seen,
  }));
}

/** open: inflight on model + principal */
function openOn(
  state: LiveState,
  principal: string,
  kind: BucklePrincipalKind | undefined,
  model: string,
): void {
  const m = state.models.get(model) ?? { inflight: 0 };
  m.inflight += 1;
  state.models.set(model, m);
  principalRowOf(state, principal, kind).inflight += 1;
}

/** close: usage tokens counted, requests bumped */
function closeOn(
  state: LiveState,
  principal: string,
  model: string,
  tokens: number,
): void {
  const m = state.models.get(model);
  if (m !== undefined && m.inflight > 0) m.inflight -= 1;
  const p = state.principals.get(principal);
  if (p !== undefined) {
    if (p.inflight > 0) p.inflight -= 1;
    p.requests += 1;
    p.last_seen = Date.now();
  }
  if (tokens > 0) state.tokenEvents.push({ at: Date.now(), tokens });
}

export function createLive(hub: string) {
  const state = createLiveState();
  return {
    /** the forward loop opens a hop: inflight on model + principal. */
    open(principal: string, kind: BucklePrincipalKind | undefined, model: string): void {
      openOn(state, principal, kind, model);
    },
    /** the hop closes: usage tokens counted, requests bumped. */
    close(principal: string, model: string, tokens: number): void {
      closeOn(state, principal, model, tokens);
    },
    snapshot(): BuckleStatsSnapshot {
      const tps = windowTokensOf(state.tokenEvents, Date.now()) / (TPS_WINDOW_MS / 1000);
      return {
        hub,
        models: modelRowsOf(state.models, tps),
        current_connections: state.principals.size,
        tps,
        principals: principalRowsOf(state.principals),
      };
    },
  };
}
