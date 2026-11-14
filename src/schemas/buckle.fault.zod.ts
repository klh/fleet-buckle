// buckle.fault.zod.ts — THE error taxonomy. Every failure in the
// system decomposes into exactly one Fault; no module swallows a
// throw or returns an anonymous null. Kinds:
//   timeout      — a bounded wait expired (AbortSignal.timeout)
//   unreachable  — dns/refused/reset: nothing answered
//   denied       — an HTTP refusal answered (status carried)
//   malformed    — a body failed its parse (wire drift fails loud)
//   io           — anything else, NAMED (never swallowed silently)
import { z } from "zod";

export const Fault = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("timeout") }).strict(),
  z.object({ kind: z.literal("unreachable") }).strict(),
  z.object({ kind: z.literal("denied"), status: z.number().int() }).strict(),
  z.object({ kind: z.literal("malformed"), detail: z.string() }).strict(),
  z.object({ kind: z.literal("io"), detail: z.string() }).strict(),
]);
export type Fault = z.output<typeof Fault>;
