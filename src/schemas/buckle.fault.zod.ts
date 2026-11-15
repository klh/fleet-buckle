// buckle.fault.zod.ts — THE error taxonomy. Every failure in the
// system decomposes into exactly one Fault; no module swallows a
// throw or returns an anonymous null. Kinds:
//   timeout      — a bounded wait expired (AbortSignal.timeout)
//   unreachable  — dns/refused/reset: nothing answered
//   denied       — an HTTP refusal answered (status carried)
//   malformed    — a body failed its parse (wire drift fails loud)
//   io           — anything else, NAMED (never swallowed silently)
import { z } from "zod";

/** the fault KINDS — ONE named enum (the taxonomy's discriminants);
 *  the event payloads compose it, never a re-declared mirror */
export const FaultKind = z.enum(["timeout", "unreachable", "denied", "malformed", "io"]);
export type FaultKind = z.output<typeof FaultKind>;

export const Fault = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("timeout") }).strict(),
  z.object({ kind: z.literal("unreachable") }).strict(),
  z.object({ kind: z.literal("denied"), status: z.number().int() }).strict(),
  z.object({ kind: z.literal("malformed"), detail: z.string() }).strict(),
  z.object({ kind: z.literal("io"), detail: z.string() }).strict(),
]);
export type Fault = z.output<typeof Fault>;
