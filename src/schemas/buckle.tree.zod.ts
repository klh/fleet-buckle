// buckle.tree.zod.ts — the federated tree: a recursive node per buckle.
// Downstream-only by construction; each node's models already passed the
// per-hop grant checks on the way up.
import { z } from "zod";
import { BuckleModelWire } from "./buckle.model.wire.zod.ts";

export const BuckleNode: z.ZodType<BuckleTreeNode> = z.lazy(() =>
  z
    .object({
      buckle: z
        .object({ label: z.string().min(1), url: z.url().optional() })
        .strict(),
      models: z.array(BuckleModelWire),
      stats: z
        .object({
          current_connections: z.number().int().min(0),
          tps: z.number().min(0),
        })
        .strict()
        .optional(),
      connections: z
        .array(
          z
            .object({
              principal: z.string().min(1),
              machine: z.string().optional(),
              inflight: z.number().int().min(0),
              connected_since: z.number().int().min(0),
              last_seen: z.number().int().min(0),
            })
            .strict(),
        )
        .optional(),
      peers: z.array(BuckleNode),
    })
    .strict(),
);

export interface BuckleTreeNode {
  buckle: { label: string; url?: string };
  models: z.output<typeof BuckleModelWire>[];
  stats?: { current_connections: number; tps: number };
  connections?: {
    principal: string;
    machine?: string;
    inflight: number;
    connected_since: number;
    last_seen: number;
  }[];
  peers: BuckleTreeNode[];
}

export const BuckleTreeResponse = z
  .object({ self: BuckleNode })
  .strict();
export type BuckleTreeResponse = z.output<typeof BuckleTreeResponse>;
