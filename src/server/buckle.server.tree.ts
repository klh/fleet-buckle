// buckle.server.tree.ts — the federated tree: DOWNSTREAM only (law d —
// we pull peers' trees, never call up). Depth is bounded BY DESIGN:
// self renders peer nodes; a peer's own peers arrive as SUMMARIES.
// A dead peer fails SOFT: its label rides with empty models — the tree
// of record stays ours.
import type {
  BucklePeer,
  BuckleSettings,
} from "../schemas/buckle.settings.zod.ts";
import type {
  BuckleTreeNode,
  BuckleTreePeer,
} from "../schemas/buckle.tree.zod.ts";
import { buildCatalog } from "./buckle.server.models.ts";
import type { LiveTracker } from "./buckle.server.live.ts";
import { continueTraceparent } from "./buckle.server.telemetry.ts";

const PEER_TIMEOUT_MS = 1500;

export type TokenReader = (file: string) => string | null;

async function pullPeerTree(
  peer: BucklePeer,
  tokenOf: TokenReader,
  traceparent: string,
): Promise<{ self: BuckleTreeNode } | null> {
  const headers: Record<string, string> = {
    traceparent: continueTraceparent(traceparent),
  };
  if (peer.token_file !== undefined) {
    const token = tokenOf(peer.token_file);
    if (token !== null) headers["authorization"] = `Bearer ${token}`;
  }
  try {
    const r = await fetch(`${peer.url.replace(/\/$/, "")}/v1/tree`, {
      headers,
      signal: AbortSignal.timeout(PEER_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    return (await r.json()) as { self: BuckleTreeNode };
  } catch {
    return null;
  }
}

export async function buildTree(
  settings: BuckleSettings,
  live: LiveTracker,
  tokenOf: TokenReader,
  traceparent: string,
): Promise<{ self: BuckleTreeNode }> {
  const catalog = await buildCatalog(settings, traceparent);
  const snap = live.snapshot();
  const peers: BuckleTreePeer[] = [];
  for (const [label, peer] of Object.entries(settings.hubs ?? {})) {
    const pulled = await pullPeerTree(peer, tokenOf, traceparent);
    if (pulled === null) {
      // fail soft: the label is known from settings; models are not
      peers.push({ buckle: { label }, models: [], peers: [] });
      continue;
    }
    const node = pulled.self;
    peers.push({
      buckle: node.buckle,
      models: node.models,
      ...(node.stats !== undefined ? { stats: node.stats } : {}),
      ...(node.connections !== undefined ? { connections: node.connections } : {}),
      // depth 2: the peer's own peers arrive as SUMMARIES (bounded walk)
      peers: node.peers.map((sub) => ({
        buckle: sub.buckle,
        models: sub.models,
        ...(sub.stats !== undefined ? { stats: sub.stats } : {}),
      })),
    });
  }
  return {
    self: {
      buckle: {
        label: settings.hub.label,
        ...(settings.hub.url !== undefined ? { url: settings.hub.url } : {}),
      },
      models: catalog.models,
      stats: {
        current_connections: snap.current_connections,
        tps: snap.tps,
      },
      connections: snap.principals.map((p) => ({
        principal: p.principal,
        inflight: p.inflight,
        connected_since: p.connected_since,
        last_seen: p.last_seen,
      })),
      peers,
    },
  };
}
