// buckle.server.problem.ts — the ONE problem+json responder (RFC 9457).
// Every face answers errors through here; nothing invents its own error
// format. Lived in forward.ts until the hop needed it too. The scrub
// guard (port law from the old scrub rules): hop outcomes RELAY peer text
// into client-facing details — secret shapes and home paths never ride.
import {
  BuckleProblem,
  BuckleProblemStatus,
  type BuckleProblemKind,
} from "../schemas/buckle.problem.zod.ts";

const SECRET_SHAPES =
  /\b(?:sk-[A-Za-z0-9_-]{8,}|bksk_[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|gho_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|bearer\s+[A-Za-z0-9._~+/=-]{8,})/gi;
const USER_PATH = /\/Users\/[A-Za-z0-9._-]+/g;

/** every problem detail passes through here — redact key/token shapes,
 *  collapse home paths. Text we authored ourselves stays identical. */
export function scrubDetail(text: string): string {
  return text.replace(SECRET_SHAPES, "[redacted]").replace(USER_PATH, "~");
}

export function problemResponse(
  kind: BuckleProblemKind,
  title: string,
  detail?: string,
  headers?: Record<string, string>,
): Response {
  const problem = BuckleProblem.parse({
    type: "https://buckle.fleet/problems/1",
    kind,
    title,
    status: BuckleProblemStatus[kind],
    ...(detail === undefined ? {} : { detail: scrubDetail(detail) }),
  });
  return Response.json(problem, {
    status: problem.status,
    headers: {
      "content-type": "application/problem+json",
      ...(headers ?? {}),
    },
  });
}
