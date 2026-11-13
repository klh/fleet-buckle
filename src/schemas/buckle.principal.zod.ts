// buckle.principal.zod.ts — WHO connects. Entra-mappable by design, but
// NOT Entra: upn-shaped ids, a kind, group memberships. A key minted to a
// principal authenticates as that principal everywhere downstream.
import { z } from "zod";

export const BucklePrincipalKind = z.enum([
  "human",
  "developer",
  "agent",
  "service",
]);
export type BucklePrincipalKind = z.output<typeof BucklePrincipalKind>;

/** upn-shaped: "alice@fleet", "agent-07@fleet.local". */
export const BucklePrincipalId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9.-]*$/);
export type BucklePrincipalId = z.output<typeof BucklePrincipalId>;

export const BucklePrincipal = z
  .object({
    id: BucklePrincipalId,
    kind: BucklePrincipalKind,
    /** Group memberships — Entra groups map onto these verbatim. */
    groups: z.array(z.string().min(1)).default([]),
    /** Named tier override; absent = the tier for this kind. */
    tier: z.string().min(1).optional(),
    /** Per-principal limits; field-wise over the tier (most specific wins). */
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
export type BucklePrincipal = z.output<typeof BucklePrincipal>;
