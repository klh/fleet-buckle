// buckle.server.problem.ts — the ONE problem+json responder (RFC 9457).
// Every face answers errors through here; nothing invents its own error
// format. Lived in forward.ts until the hop needed it too.
import {
  BuckleProblem,
  BuckleProblemStatus,
  type BuckleProblemKind,
} from "../schemas/buckle.problem.zod.ts";

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
    ...(detail === undefined ? {} : { detail }),
  });
  return Response.json(problem, {
    status: problem.status,
    headers: {
      "content-type": "application/problem+json",
      ...(headers ?? {}),
    },
  });
}
