// buckle.tree.zod.ts — the federated tree: one node per buckle.
// Downstream-only by construction; each node's models already passed the
// per-hop grant checks on the way up.
//
// REPO RULE: every type is z.output of a schema — no hand-written
// interface, no annotation. zod 4.6 has no getter-recursion (z.interface),
// so the walk is bounded BY DESIGN (it is bounded in reality — acyclic,
// hub tiers): BuckleNode renders self + peers; a peer renders itself +
// peer-of-peer SUMMARIES. Full inference, fail-loud at every level.
import { z } from "zod";
import { BuckleModelWire } from "./buckle.model.wire.zod.ts";

const BuckleLabel = z.object({ label: z.string().min(1), url: z.url().optional() }).strict();

const BuckleStats = z
  .object({
    current_connections: z.number().int().min(0),
    tps: z.number().min(0),
  })
  .strict();

const BuckleConnection = z
  .object({
    principal: z.string().min(1),
    machine: z.string().optional(),
    inflight: z.number().int().min(0),
    connected_since: z.number().int().min(0),
    last_seen: z.number().int().min(0),
  })
  .strict();

// depth 2 — the peer-of-peer: label + models + stats, no deeper walk
export const BuckleTreePeerSummary = z
  .object({
    buckle: BuckleLabel,
    models: z.array(BuckleModelWire),
    stats: BuckleStats.optional(),
  })
  .strict();
export type BuckleTreePeerSummary = z.output<typeof BuckleTreePeerSummary>;

// depth 1 — a direct peer: full node + its own peers (as summaries)
export const BuckleTreePeer = z
  .object({
    buckle: BuckleLabel,
    models: z.array(BuckleModelWire),
    stats: BuckleStats.optional(),
    connections: z.array(BuckleConnection).optional(),
    peers: z.array(BuckleTreePeerSummary),
  })
  .strict();
export type BuckleTreePeer = z.output<typeof BuckleTreePeer>;

// depth 0 — self
export const BuckleNode = z
  .object({
    buckle: BuckleLabel,
    models: z.array(BuckleModelWire),
    stats: BuckleStats.optional(),
    connections: z.array(BuckleConnection).optional(),
    peers: z.array(BuckleTreePeer),
  })
  .strict();
export type BuckleTreeNode = z.output<typeof BuckleNode>;

export const BuckleTreeResponse = z.object({ self: BuckleNode }).strict();
export type BuckleTreeResponse = z.output<typeof BuckleTreeResponse>;
