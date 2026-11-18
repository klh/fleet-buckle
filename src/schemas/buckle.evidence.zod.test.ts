import { expect, test } from "bun:test";
import fixture from "./fixtures/worker-receipts.v1.json";
import { BuckleEvidenceReceipt, BuckleTraceJoin } from "./buckle.evidence.zod.ts";
import { z } from "zod";

// Local mirror of the Worker contract, validated against the versioned fixture (no sibling imports).
const Epoch = z.number().int().nonnegative();
const Accepted = z.object({ state: z.literal("accepted"), requestId: z.string().min(1), submissionId: z.string().min(1), epoch: Epoch, duplicate: z.boolean() });
const Settled = z.object({ state: z.literal("settled"), requestId: z.string().min(1), submissionId: z.string().min(1), epoch: Epoch, outcome: z.enum(["completed", "failed", "aborted"]), detail: z.string().optional() });
const Receipt = z.discriminatedUnion("state", [Accepted, Settled]);

const join = {
  runnerId: fixture.valid.runnerAssignment.runnerId,
  writerEpoch: fixture.valid.runnerAssignment.writerEpoch,
  piConversationId: fixture.valid.runnerAssignment.rootConversationId,
  submissionId: fixture.valid.acceptedReceipt.submissionId,
  requestId: fixture.valid.acceptedReceipt.requestId,
  traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
  buckleCallId: "bc-1",
};

test("fixture version and worker receipts", () => {
  expect(fixture.schemaVersion).toBe(1);
  expect(Receipt.safeParse(fixture.valid.acceptedReceipt).success).toBe(true);
  expect(Receipt.safeParse(fixture.valid.settledReceipt).success).toBe(true);
  expect(Receipt.safeParse(fixture.invalid.negativeEpoch).success).toBe(false);
  expect(Receipt.safeParse(fixture.invalid.badOutcome).success).toBe(false);
});
test("trace join built from fixture ids", () => {
  expect(BuckleTraceJoin.safeParse(join).success).toBe(true);
  expect(BuckleTraceJoin.safeParse({ ...join, runnerId: "nope" }).success).toBe(false);
  expect(BuckleTraceJoin.safeParse({ ...join, traceparent: "bad" }).success).toBe(false);
  expect(BuckleTraceJoin.safeParse({ ...join, writerEpoch: -1 }).success).toBe(false);
});
test("missing usage stays unknown, never 0", () => {
  const e = { kind: "error", join, status: 502, code: "upstream", usage: { known: false, reason: "no usage in stream" } };
  expect(BuckleEvidenceReceipt.safeParse(e).success).toBe(true);
  expect(BuckleEvidenceReceipt.safeParse({ ...e, usage: { known: false, reason: "x", inputTokens: 0 } }).success).toBe(false);
  expect(BuckleEvidenceReceipt.safeParse({ ...e, usage: { known: true, inputTokens: 1 } }).success).toBe(false);
  expect(BuckleEvidenceReceipt.safeParse({ kind: "usage", join }).success).toBe(false);
  expect(BuckleEvidenceReceipt.safeParse({ ...e, status: 200 }).success).toBe(false);
});
