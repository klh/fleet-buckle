// buckle.evidence.zod.ts — trace joins and error / missing-usage receipts.
// Unknown stays unknown: usage numbers are never defaulted to 0.
import { z } from "zod";
import { BuckleRouteFamily } from "./buckle.identity.zod.ts";

const Epoch = z.number().int().nonnegative();
export const Traceparent = z.string().regex(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);

export const BuckleTraceJoin = z
  .object({
    runnerId: z.uuid(),
    writerEpoch: Epoch,
    piConversationId: z.string().min(1),
    submissionId: z.string().min(1),
    requestId: z.string().min(1),
    traceparent: Traceparent,
    buckleCallId: z.string().min(1),
    litellmCallId: z.string().min(1).optional(),
    routeFamily: BuckleRouteFamily.optional(),
  })
  .strict();
export type BuckleTraceJoin = z.output<typeof BuckleTraceJoin>;

const Tokens = z.number().int().nonnegative();

export const BuckleUsage = z.discriminatedUnion("known", [
  z.object({ known: z.literal(true), inputTokens: Tokens, outputTokens: Tokens }).strict(),
  z.object({ known: z.literal(false), reason: z.string().min(1) }).strict(),
]);
export type BuckleUsage = z.output<typeof BuckleUsage>;

export const BuckleErrorReceipt = z
  .object({
    kind: z.literal("error"),
    join: BuckleTraceJoin,
    status: z.number().int().min(400).max(599),
    code: z.string().min(1),
    usage: BuckleUsage,
  })
  .strict();

export const BuckleUsageReceipt = z
  .object({ kind: z.literal("usage"), join: BuckleTraceJoin, usage: BuckleUsage })
  .strict();

export const BuckleEvidenceReceipt = z.discriminatedUnion("kind", [BuckleErrorReceipt, BuckleUsageReceipt]);
export type BuckleEvidenceReceipt = z.output<typeof BuckleEvidenceReceipt>;
