// metrics/buckle.metrics.tracker.ts — the live overview state machine: per-model
// inflight + requests + tokens (rolling-window tps), per-principal
// sessions (requests/tokens/connected_since). The proxy pipeline
// opens/closes around each forwarded chat; snapshot() renders the
// per-hub view (sessions fold included) the stats face serves.
// TYPE LAW: the principal kind is the SCHEMA's enum
// (buckle.principal.zod) — never an inline union, never a cast.
import { z } from "zod";
import { BucklePrincipalKind } from "../schemas/buckle.principal.zod.ts";
import type { BuckleEvent, EventBus, EventSubscriber } from "../events/buckle.events.bus.ts";
import type { BuckleStatsSnapshot } from "../schemas/buckle.stats.zod.ts";
import { pick } from "../pick.ts";

/** tokens-per-second rides a 10s rolling window (definitional, not a
 *  tunable — the window IS what "current tps" means here) */
const TPS_WINDOW_MS = 10_000;

export type LiveTracker = ReturnType<typeof createLive>;

/** the tracked session row — kind optional (a principal may open
 *  before its registry row is looked at), everything else
 *  always-known. zod-derived (the type law) */
export const TrackedPrincipalState = z
  .object({
    inflight: z.number().int().min(0),
    requests: z.number().int().min(0),
    tokens: z.number().int().min(0),
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
    models: new Map<string, { inflight: number; requests: number; tokens: number }>(),
    principals: new Map<string, TrackedPrincipal>(),
    tokenEvents: [] as { at: number; tokens: number }[],
  };
}
type LiveState = ReturnType<typeof createLiveState>;

/** the principal's session row, lazily created (kind stamps only on
 *  creation — the FIRST open wins, never re-stamped) */
function principalRowOf(
  state: LiveState,
  id: string,
  kind: BucklePrincipalKind | undefined,
): TrackedPrincipal {
  let row = state.principals.get(id);
  if (row === undefined) {
    row = {
      inflight: 0,
      requests: 0,
      tokens: 0,
      connected_since: Date.now(),
      last_seen: 0,
    };
    if (kind !== undefined) row.kind = kind;
    state.principals.set(id, row);
  }
  return row;
}

/** tokens banked inside the rolling window (pure fold) */
function windowTokensOf(events: { at: number; tokens: number }[], now: number): number {
  let tokens = 0;
  for (const e of events) if (now - e.at <= TPS_WINDOW_MS) tokens += e.tokens;
  return tokens;
}

/** the snapshot's model rows (pure map over the models state) */
function modelRowsOf(
  models: Map<string, { inflight: number; requests: number; tokens: number }>,
  tps: number,
): BuckleStatsSnapshot["models"] {
  return [...models.entries()].map(([model, m]) => ({
    model,
    inflight: m.inflight,
    requests: m.requests,
    tokens: m.tokens,
    tps,
  }));
}

/** the snapshot's principal rows (pure map over the sessions state) */
function principalRowsOf(
  principals: Map<string, TrackedPrincipal>,
): BuckleStatsSnapshot["principals"] {
  return [...principals.entries()].map(([principal, p]) => ({
    principal,
    ...pick("kind", p.kind),
    inflight: p.inflight,
    requests: p.requests,
    tokens: p.tokens,
    connected_since: p.connected_since,
    last_seen: p.last_seen,
  }));
}

/** the sessions fold: kind-split counts, longest running session,
 *  top token consumers (top 5) — pure over the session rows */
function sessionsOf(
  principals: Map<string, TrackedPrincipal>,
  now: number,
): BuckleStatsSnapshot["sessions"] {
  const byKind = new Map<string, number>();
  let longestRunningS = 0;
  const top = [...principals.entries()]
    .map(([principal, p]) => {
      if (p.kind !== undefined) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
      longestRunningS = Math.max(longestRunningS, (now - p.connected_since) / 1000);
      return {
        principal,
        ...pick("kind", p.kind),
        requests: p.requests,
        tokens: p.tokens,
      };
    })
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5);
  return {
    by_kind: Object.fromEntries(byKind),
    longest_running_s: longestRunningS,
    top_tokens: top,
  };
}

/** open: inflight on model + session */
function openOn(
  state: LiveState,
  principal: string,
  kind: BucklePrincipalKind | undefined,
  model: string,
): void {
  const m = state.models.get(model) ?? { inflight: 0, requests: 0, tokens: 0 };
  m.inflight += 1;
  state.models.set(model, m);
  principalRowOf(state, principal, kind).inflight += 1;
}

/** the model row's close half: inflight down, requests + tokens banked */
function closeModelOn(state: LiveState, model: string, tokens: number): void {
  const m = state.models.get(model);
  if (m === undefined) return;
  if (m.inflight > 0) m.inflight -= 1;
  m.requests += 1;
  m.tokens += tokens;
}

/** the session row's close half: inflight down, requests + tokens
 *  banked, last_seen stamped */
function closeSessionOn(state: LiveState, principal: string, tokens: number): void {
  const p = state.principals.get(principal);
  if (p === undefined) return;
  if (p.inflight > 0) p.inflight -= 1;
  p.requests += 1;
  p.tokens += tokens;
  p.last_seen = Date.now();
}

/** close: usage tokens banked (model + session + window), requests bumped */
function closeOn(state: LiveState, principal: string, model: string, tokens: number): void {
  closeModelOn(state, model, tokens);
  closeSessionOn(state, principal, tokens);
  if (tokens > 0) state.tokenEvents.push({ at: Date.now(), tokens });
}

export function createLive(hub: string) {
  const state = createLiveState();
  return {
    /** the forward loop opens a hop: inflight on model + session. */
    open(principal: string, kind: BucklePrincipalKind | undefined, model: string): void {
      openOn(state, principal, kind, model);
    },
    /** the hop closes: usage tokens banked, requests bumped. */
    close(principal: string, model: string, tokens: number): void {
      closeOn(state, principal, model, tokens);
    },
    snapshot(): BuckleStatsSnapshot {
      const now = Date.now();
      const tps = windowTokensOf(state.tokenEvents, now) / (TPS_WINDOW_MS / 1000);
      const models = modelRowsOf(state.models, tps);
      return {
        hub,
        models,
        active_models: models.filter((m) => m.inflight > 0 || m.requests > 0).length,
        current_connections: state.principals.size,
        tps,
        principals: principalRowsOf(state.principals),
        sessions: sessionsOf(state.principals, now),
      };
    },
  };
}

/** the tracker as a BUS SUBSCRIBER — the pipeline emits, this
 *  collects: opened → openOn, served → closeOn(usage), failed →
 *  closeOn(0). O(1) in-memory bookkeeping (the non-blocking contract). */
export function subscribeTracker(bus: EventBus, live: LiveTracker): void {
  const collect: EventSubscriber = (event: BuckleEvent): void => {
    if (event.kind === "request.opened")
      live.open(event.principal, event.principalKind, event.model);
    else if (event.kind === "request.served")
      live.close(event.principal, event.model, event.tokens);
    else live.close(event.principal, event.model, 0);
  };
  bus.subscribe(collect);
}
