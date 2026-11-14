// buckle.metrics.stats.ts — the /v1/stats body: OUR snapshot (live,
// always fresh) + every configured peer's SELF snapshot pulled
// through the ONE seam (federation.peer), folded into the fleet
// ROLLUP. The peer pull is MEM-CACHED (settings.timeouts.stats_cache_ms,
// single-flight) — a stats GET never pays per-peer round trips on
// every request. A dead peer contributes an honest null — its fault
// is logged at the seam, named, never swallowed. Each hub is counted
// ONCE: only a peer's SELF snapshot folds (never its own peers').
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import {
  BuckleStatsResponse,
  BuckleStatsRollup,
  type BuckleStatsResponse as StatsResponse,
  type BuckleStatsSnapshot,
} from "../schemas/buckle.stats.zod.ts";
import { pick } from "../pick.ts";
import { peerJson, type TokenReader } from "../federation/buckle.federation.peer.ts";
import type { LiveTracker } from "./buckle.metrics.tracker.ts";
import { createWindowCache } from "./buckle.metrics.window.ts";
import type { EngineTelemetrySource } from "./buckle.metrics.engine.ts";

/** which bucket a session kind rolls into — data, not branches
 *  (the kinds are the principal enum's closed set) */
const BUCKET_OF: Record<string, "users" | "agents" | "services"> = {
  human: "users",
  developer: "users",
  agent: "agents",
};

/** the kind buckets: users (human|developer), agents, everything
 *  else reports as services — pure fold over the hubs' by_kind */
function sessionTotalsOf(
  hubs: BuckleStatsSnapshot[],
): { users: number; agents: number; services: number } {
  const totals = { users: 0, agents: 0, services: 0 };
  for (const hub of hubs)
    for (const [kind, count] of Object.entries(hub.sessions.by_kind))
      totals[BUCKET_OF[kind] ?? "services"] += count;
  return totals;
}

/** distinct model ids with live traffic across the fleet */
function activeModelCountOf(hubs: BuckleStatsSnapshot[]): number {
  const active = new Set<string>();
  for (const hub of hubs)
    for (const m of hub.models)
      if (m.inflight > 0 || m.requests > 0) active.add(m.model);
  return active.size;
}

/** the fleet's top token consumers (top 5), hub-labelled */
function topTokensOf(
  hubs: BuckleStatsSnapshot[],
): { hub: string; principal: string; kind?: string; tokens: number }[] {
  return hubs
    .flatMap((hub) =>
      hub.sessions.top_tokens.map((s) => ({
        hub: hub.hub,
        principal: s.principal,
        ...pick("kind", s.kind),
        tokens: s.tokens,
      })),
    )
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5);
}

/** the fleet rollup — pure fold over the reachable snapshots */
function rollupOf(
  self: BuckleStatsSnapshot,
  peers: Record<string, BuckleStatsSnapshot | null>,
): BuckleStatsRollup {
  const hubs = [self, ...Object.values(peers).filter((p) => p !== null)];
  return BuckleStatsRollup.parse({
    hubs: hubs.length,
    tps: hubs.reduce((sum, h) => sum + h.tps, 0),
    current_connections: hubs.reduce((sum, h) => sum + h.current_connections, 0),
    active_models: activeModelCountOf(hubs),
    sessions: sessionTotalsOf(hubs),
    longest_running_s: Math.max(0, ...hubs.map((h) => h.sessions.longest_running_s)),
    top_tokens: topTokensOf(hubs),
  });
}

async function pullPeers(
  settings: BuckleSettings,
  tokenOf: TokenReader,
): Promise<Record<string, BuckleStatsSnapshot | null>> {
  const peers: Record<string, BuckleStatsSnapshot | null> = {};
  for (const [label, peer] of Object.entries(settings.hubs ?? {})) {
    // the peer answers OUR wire face; its SELF snapshot is what folds
    const pulled = await peerJson(peer, {
      seam: "metrics.stats",
      path: "/v1/stats",
      schema: BuckleStatsResponse,
      tokenOf,
      timeoutMs: settings.timeouts.peer_pull_ms,
    });
    peers[label] = pulled.ok ? (pulled.data.self ?? null) : null;
  }
  return peers;
}

/** the mem cache over the peer fold: one TTL window
 *  (settings.timeouts.stats_cache_ms), single-flight — concurrent
 *  stats GETs share the in-flight pull; a fault folds nulls and the
 *  window still turns (fresh verdicts, never a stale-forever cache). */
export function createStatsCache(settings: BuckleSettings, tokenOf: TokenReader) {
  // the shared window primitive (metrics.window): TTL +
  // single-flight; the pull never rejects (peerJson folds faults
  // as nulls), so the cache can hold them — fresh verdicts each window
  const window = createWindowCache(
    settings.timeouts.stats_cache_ms,
    () => pullPeers(settings, tokenOf),
  );
  return { peers: (): Promise<Record<string, BuckleStatsSnapshot | null>> => window.get() };
}

/** the stats body: own snapshot LIVE (engine telemetry on its own
 *  window — surfaced, never re-counted) + cached peer fold + rollup */
export async function statsBody(
  settings: BuckleSettings,
  live: LiveTracker,
  cache: ReturnType<typeof createStatsCache>,
  engine?: EngineTelemetrySource,
): Promise<StatsResponse> {
  const telemetry =
    settings.engine !== undefined && engine !== undefined ? await engine.get() : undefined;
  const self = { ...live.snapshot(), ...pick("engine", telemetry) };
  const peers = await cache.peers();
  return BuckleStatsResponse.parse({ self, peers, rollup: rollupOf(self, peers) });
}
