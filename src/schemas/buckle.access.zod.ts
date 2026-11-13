// buckle.access.zod.ts — per-buckle access registry: tiers (defaults per
// principal kind), principals, grants (scopes + limits). Each buckle holds
// its OWN registry — like an AD domain — and federation checks grants at
// every hop against the peer's own registry.
import { z } from "zod";
import { BucklePrincipal } from "./buckle.principal.zod.ts";

export const BuckleScope = z.enum([
  "models.list",
  "models.use",
  "stats.read",
  "tree.read",
  "admin",
]);
export type BuckleScope = z.output<typeof BuckleScope>;

/** A tier names a default limit profile. `kind` ties it to a principal
 *  kind (agent vs developer vs human), so tiers fall out of the box. */
export const BuckleTier = z
  .object({
    label: z.string().min(1),
    kind: z.enum(["human", "developer", "agent", "service"]),
    max_concurrent: z.number().int().positive().optional(),
    max_per_ip: z.number().int().positive().optional(),
    max_rpm: z.number().int().positive().optional(),
  })
  .strict();
export type BuckleTier = z.output<typeof BuckleTier>;

/** A grant: what a principal may do ON THIS BUCKLE. */
export const BuckleGrant = z
  .object({
    principal: z.string().min(1),
    scopes: z.array(BuckleScope).min(1),
    limits: z
      .object({
        max_concurrent: z.number().int().positive().optional(),
        max_per_ip: z.number().int().positive().optional(),
        max_rpm: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type BuckleGrant = z.output<typeof BuckleGrant>;

export const BuckleAccessRegistry = z
  .object({
    tiers: z.array(BuckleTier).default([]),
    principals: z.array(BucklePrincipal).default([]),
    grants: z.array(BuckleGrant).default([]),
  })
  .strict();
export type BuckleAccessRegistry = z.output<typeof BuckleAccessRegistry>;
