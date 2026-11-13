// buckle.problem.zod.ts — eight semantic error kinds, one shape
// (problem+json, RFC 9457). They flow unchanged from throw-site to HTTP to
// client; nothing invents its own error format.
import { z } from "zod";

export const BuckleProblemKind = z.enum([
  "validation",
  "unauthenticated",
  "forbidden",
  "not-found",
  "conflict",
  "rate-limited",
  "unavailable",
  "internal",
]);
export type BuckleProblemKind = z.output<typeof BuckleProblemKind>;

export const BuckleProblemStatus: Record<
  z.output<typeof BuckleProblemKind>,
  number
> = {
  validation: 422,
  unauthenticated: 401,
  forbidden: 403,
  "not-found": 404,
  conflict: 409,
  "rate-limited": 429,
  unavailable: 503,
  internal: 500,
};

export const BuckleProblem = z
  .object({
    type: z.literal("https://buckle.fleet/problems/1"),
    kind: BuckleProblemKind,
    title: z.string().min(1),
    status: z.number().int(),
    detail: z.string().optional(),
    /** Field errors from z.treeifyError() for kind=validation. */
    errors: z.unknown().optional(),
    requestId: z.string().min(1).optional(),
    retryAfter: z.number().int().positive().optional(),
  })
  .strict();
export type BuckleProblem = z.output<typeof BuckleProblem>;
