// catalog/buckle.catalog.topology.ts — the topology view (/v1/tree): the
// org chart of hubs, DOWNSTREAM only (law d — we pull peers' trees,
// never call up). Depth is bounded BY DESIGN: self renders peer
// nodes; a peer's own peers arrive as SUMMARIES (depth 2). A dead
// peer fails SOFT — its label rides with empty models, the fault is
// logged at the seam, and the tree of record stays ours. Optional
// sections are built with the ONE pick primitive (omit-when-absent) —
// never a conditional-spread ternary.
import type {
  BucklePeer,
  BuckleSettings,
} from "../schemas/buckle.settings.zod.ts";
import {
  BuckleTreeResponse,
  type BuckleTreeNode,
  type BuckleTreePeer,
  type BuckleTreePeerSummary,
} from "../schemas/buckle.tree.zod.ts";
import { peerJson, type TokenReader } from "../federation/buckle.federation.peer.ts";
import type { LiveTracker } from "../metrics/buckle.metrics.tracker.ts";
import { pick } from "../pick.ts";
import { buildCatalog } from "./buckle.catalog.fetch.ts";

/** pull a peer's tree node through the ONE seam; a fault folds SOFT
 *  (null) — logged at the seam, the tree of record stays ours */
async function pullPeerTree(
  peer: BucklePeer,
  tokenOf: TokenReader,
  traceparent: string,
  timeoutMs: number,
): Promise<BuckleTreeNode | null> {
  const pulled = await peerJson(peer, {
    seam: "catalog.topology",
    path: "/v1/tree",
    schema: BuckleTreeResponse,
    tokenOf,
    timeoutMs,
    traceparent,
  });
  return pulled.ok ? (pulled.data.self ?? null) : null;
}

/** a peer's own peers render as SUMMARIES (bounded walk, depth 2) */
function summaryOf(sub: BuckleTreePeerSummary): BuckleTreePeerSummary {
  return {
    buckle: sub.buckle,
    models: sub.models,
    ...pick("stats", sub.stats),
  };
}

function peerNodeOf(
  label: string,
  node: BuckleTreeNode | null,
): BuckleTreePeer {
  if (node === null)
    // fail soft: the label is known from settings; models are not
    return { buckle: { label }, models: [], peers: [] };
  return {
    buckle: node.buckle,
    models: node.models,
    ...pick("stats", node.stats),
    ...pick("connections", node.connections),
    peers: node.peers.map(summaryOf),
  };
}

export async function buildTree(
  settings: BuckleSettings,
  live: LiveTracker,
  tokenOf: TokenReader,
  traceparent: string,
): Promise<{ self: BuckleTreeNode }> {
  const catalog = await buildCatalog(settings, traceparent, tokenOf);
  const snap = live.snapshot();
  const peers: BuckleTreePeer[] = [];
  for (const [label, peer] of Object.entries(settings.hubs ?? {})) {
    peers.push(
      peerNodeOf(
        label,
        await pullPeerTree(peer, tokenOf, traceparent, settings.timeouts.peer_pull_ms),
      ),
    );
  }
  return {
    self: {
      buckle: {
        label: settings.hub.label,
        ...pick("url", settings.hub.url),
      },
      models: catalog.models,
      stats: {
        current_connections: snap.current_connections,
        tps: snap.tps,
      },
      connections: snap.principals.map((p) => ({
        principal: p.principal,
        ...pick("kind", p.kind),
        inflight: p.inflight,
        requests: p.requests,
        tokens: p.tokens,
        connected_since: p.connected_since,
        last_seen: p.last_seen,
      })),
      peers,
    },
  };
}
