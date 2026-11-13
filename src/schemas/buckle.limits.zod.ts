// buckle.limits.zod.ts — the ONE connection-caps schema (the schema
// composition law: a shape is declared ONCE and composed everywhere —
// settings, tiers, grants, principals and wire rows all import THIS).
// Resolution is field-wise, most specific wins: model > provider > hub.
import { z } from "zod";

export const BuckleLimits = z
  .object({
    max_concurrent: z.number().int().positive().optional(),
    max_per_ip: z.number().int().positive().optional(),
    max_rpm: z.number().int().positive().optional(),
  })
  .strict();
export type BuckleLimits = z.output<typeof BuckleLimits>;
