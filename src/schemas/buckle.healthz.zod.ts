// buckle.healthz.zod.ts — the buckle's own healthz face: what the
// fleet-health sidecar polls over the network. A server can never
// paint itself healthy — this face answers, the SIDECAR swears.
import { z } from "zod";

export const BuckleHealthz = z
  .object({
    ok: z.boolean(),
    status: z.enum(["up", "down"]),
    label: z.string().min(1),
    // optional version stamp from settings (hub.version) — the rolling
    // deploy switch proves itself here: same hub, new version answering
    version: z.string().min(1).optional(),
    // W3C trace id of this answer — tracing ids through everything
    trace_id: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .strict();
export type BuckleHealthz = z.output<typeof BuckleHealthz>;
