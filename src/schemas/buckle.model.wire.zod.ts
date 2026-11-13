// buckle.model.wire.zod.ts — the /v1/models row as it travels: identity,
// origin (provider on this hub, or a peer buckle), our limits, our live
// numbers, and the provider's FULL metadata verbatim (ms copilot's
// capabilities/supports/policy/picker flags ride along — captured, never
// fabricated).
import { z } from "zod";

export const BuckleModelOrigin = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("provider"),
      label: z.string().min(1),
      url: z.url().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("buckle"),
      label: z.string().min(1),
      url: z.url(),
    })
    .strict(),
]);
export type BuckleModelOrigin = z.output<typeof BuckleModelOrigin>;

export const BuckleModelLimits = z
  .object({
    max_concurrent: z.number().int().positive().optional(),
    max_per_ip: z.number().int().positive().optional(),
    max_rpm: z.number().int().positive().optional(),
  })
  .strict();

export const BuckleModelLive = z
  .object({
    inflight: z.number().int().min(0),
    tps: z.number().min(0),
  })
  .strict();

export const BuckleModelWire = z
  .object({
    id: z.string().min(1),
    origin: BuckleModelOrigin,
    limits: BuckleModelLimits.optional(),
    live: BuckleModelLive.optional(),
    /** The provider's own model row, verbatim (name, capabilities, policy…). */
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type BuckleModelWire = z.output<typeof BuckleModelWire>;

export const BuckleModelsResponse = z
  .object({
    hub: z.string().min(1),
    models: z.array(BuckleModelWire),
  })
  .strict();
export type BuckleModelsResponse = z.output<typeof BuckleModelsResponse>;
