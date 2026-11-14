// buckle.live.stats.ts — the /v1/stats body: OUR snapshot + every
// configured peer's self snapshot, folded through the ONE pull seam
// (federation.peer). A dead peer contributes an honest null — the
// fault is logged at the seam, named, never swallowed.
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import {
  BuckleStatsResponse,
  type BuckleStatsSnapshot,
} from "../schemas/buckle.stats.zod.ts";
import { peerJson, type TokenReader } from "../federation/buckle.federation.peer.ts";
import type { LiveTracker } from "./buckle.live.tracker.ts";

export async function federatedStats(
  settings: BuckleSettings,
  live: LiveTracker,
  tokenOf: TokenReader,
): Promise<{
  self: BuckleStatsSnapshot;
  peers: Record<string, BuckleStatsSnapshot | null>;
}> {
  const peers: Record<string, BuckleStatsSnapshot | null> = {};
  for (const [label, peer] of Object.entries(settings.hubs ?? {})) {
    // the peer answers OUR wire face; its SELF snapshot is what folds
    const pulled = await peerJson(peer, {
      seam: "live.stats",
      path: "/v1/stats",
      schema: BuckleStatsResponse,
      tokenOf,
      timeoutMs: settings.timeouts.peer_pull_ms,
    });
    peers[label] = pulled.ok ? (pulled.data.self ?? null) : null;
  }
  return { self: live.snapshot(), peers };
}
