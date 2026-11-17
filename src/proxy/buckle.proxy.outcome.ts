// buckle.proxy.outcome.ts — the ONE served/fault outcome the legs
// emit and the pipeline settles. It lived four times (pipeline,
// engine, userleg, hop — hand-aligned); now it lives here once and
// every leg imports it: drift between legs is structurally
// impossible. Zero-import leaf beyond zod + the fault taxonomy.
import { z } from "zod";
import { Fault } from "../schemas/buckle.fault.zod.ts";
import { parseJson } from "../fault.ts";

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

/** a leg's whole answer: the journaled outcome PLUS (stream rides
 *  only) the LIVE upstream response — a side channel zod cannot
 *  carry (a ReadableStream is not serializable), consumed by the
 *  settle seam the moment the client Response is built. Buffered
 *  rides omit it and the outcome's text is the whole body. */
export type WithUpstream<O> = { outcome: O; upstream?: Response };

const StreamAsk = z.object({ stream: z.boolean() }).loose();

/** the stream decision for a chat ride: the caller ASKED for SSE
 *  (stream:true in the request body) AND the upstream answered
 *  event-stream with a live body — then and only then the leg hands
 *  the live response back instead of buffering it whole (the
 *  first-token latency of a streaming chat must not ride a full
 *  upstream drain). Non-stream asks, JSON error bodies, and engine
 *  refusals all take the buffered path unchanged. */
export function liveOutcomeOf(
  raw: string,
  response: Response,
  servedBy: string,
): { outcome: z.output<typeof ServedOutcomeSchema>; upstream: Response } | null {
  const ask = parseJson(raw);
  if (!ask.ok) return null;
  const stream = StreamAsk.safeParse(ask.data);
  if (!stream.success || !stream.data.stream) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || response.body === null) return null;
  return {
    outcome: ServedOutcomeSchema.parse({
      kind: "served",
      status: response.status,
      text: "", // streamed rides never buffer: usage tallies 0 at settle
      contentType,
      servedBy,
    }),
    upstream: response,
  };
}
