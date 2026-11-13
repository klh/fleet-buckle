// buckle.server.live.ts — the live overview tracker: per-model inflight
// + token throughput (rolling window), per-principal requests/inflight/
// last_seen. The forward loop records around the engine hop; /v1/stats
// renders the snapshot. Peer snapshots (federation) join at the route.
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import type { BuckleStatsSnapshot } from "../schemas/buckle.stats.zod.ts";

const TPS_WINDOW_MS = 10_000;

export type LiveTracker = ReturnType<typeof createLive>;

export function createLive(hub: string) {
  const models = new Map<string, { inflight: number }>();
  const principals = new Map<
    string,
    { inflight: number; requests: number; connected_since: number; last_seen: number; kind?: string }
  >();
  const tokenEvents: { at: number; tokens: number }[] = [];

  const principalRow = (id: string, kind?: string) => {
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
    open(principal: string, kind: string | undefined, model: string): void {
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
          ...(p.kind !== undefined ? { kind: p.kind as "human" | "developer" | "agent" | "service" } : {}),
          inflight: p.inflight,
          requests: p.requests,
          connected_since: p.connected_since,
          last_seen: p.last_seen,
        })),
      };
    },
  };
}

/** The federated stats route body: ours + every configured peer's
 *  snapshot (null when the peer is unreachable — fail-soft per peer). */
export async function federatedStats(
  settings: BuckleSettings,
  live: LiveTracker,
  tokenOf: (file: string) => string | null,
): Promise<{ self: BuckleStatsSnapshot; peers: Record<string, BuckleStatsSnapshot | null> }> {
  const peers: Record<string, BuckleStatsSnapshot | null> = {};
  for (const [label, peer] of Object.entries(settings.hubs ?? {})) {
    try {
      const headers: Record<string, string> = {};
      if (peer.token_file !== undefined) {
        const token = tokenOf(peer.token_file);
        if (token !== null) headers["authorization"] = `Bearer ${token}`;
      }
      const r = await fetch(`${peer.url.replace(/\/$/, "")}/v1/stats`, {
        headers,
        signal: AbortSignal.timeout(1500),
      });
      peers[label] = r.ok
        ? ((await r.json()) as BuckleStatsSnapshot)
        : null;
    } catch {
      peers[label] = null;
    }
  }
  return { self: live.snapshot(), peers };
}
