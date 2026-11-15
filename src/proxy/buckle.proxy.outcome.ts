// buckle.proxy.outcome.ts — the ONE served/fault outcome the legs
// emit and the pipeline settles. It lived four times (pipeline,
// engine, userleg, hop — hand-aligned); now it lives here once and
// every leg imports it: drift between legs is structurally
// impossible. Zero-import leaf beyond zod + the fault taxonomy.
import { z } from "zod";
import { Fault } from "../schemas/buckle.fault.zod.ts";

/** the SERVED outcome both legs share: raw bytes back out, content
 *  type preserved, the serving chain named. zod-derived (the type
 *  law) and structurally what every leg's outcome schema emits for
 *  kind="served". */
export const ServedOutcomeSchema = z
  .object({
    kind: z.literal("served"),
    status: z.number().int(),
    text: z.string(),
    contentType: z.string(),
    servedBy: z.string(),
  })
  .strict();
export type ServedOutcome = z.output<typeof ServedOutcomeSchema>;

/** the FAULT outcome (engine + BYOC legs): a transport failure
 *  already classified at the seam, named for the client verdict */
export const FaultOutcomeSchema = z.object({ kind: z.literal("fault"), fault: Fault }).strict();

/** the engine + BYOC legs' whole outcome — ONE union, ONE surface
 *  (the pipeline's settleServed consumes both identically) */
export const LegOutcomeSchema = z.discriminatedUnion("kind", [
  ServedOutcomeSchema,
  FaultOutcomeSchema,
]);
export type LegOutcome = z.output<typeof LegOutcomeSchema>;
