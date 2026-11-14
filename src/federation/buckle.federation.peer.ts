// buckle.federation.peer.ts — THE downstream pull seam. Every place
// buckle reads a peer's face (catalog view, topology tree, stats
// fold) rides peerJson: token from the peer's token_file PATH →
// Bearer, the trace continued, a bounded wait, the body parsed
// through the caller's wire schema — and every failure a TYPED fault
// (classified + logged), never an anonymous null, never a bare
// catch. This is the shared surface the old system duplicated per
// read-model; here it exists exactly once.
import type { z } from "zod";
import { Fault } from "../schemas/buckle.fault.zod.ts";
import type { BucklePeer } from "../schemas/buckle.settings.zod.ts";
import { bodyJson, httpSend, logFault } from "../fault.ts";
import { continueTraceparent } from "../trace/buckle.trace.export.ts";

/** reads a key/token file (secrets are paths, never values); the ONE
 *  implementation lives in src/settings.ts (readToken) */
export type TokenReader = (file: string) => string | null;

/** the peer's federation token (its token_file) — null when unset or
 *  unreadable; one read shape shared by every peer-facing site */
export function peerToken(peer: BucklePeer, tokenOf: TokenReader): string | null {
  return peer.token_file !== undefined ? tokenOf(peer.token_file) : null;
}

type PeerJsonResult<T> = { ok: true; data: T } | { ok: false; fault: Fault };

/** the request headers for one peer pull: continued trace when the
 *  caller rides one, the peer's federation token when it has one */
function peerHeaders(
  peer: BucklePeer,
  call: { tokenOf: TokenReader; traceparent?: string },
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (call.traceparent !== undefined)
    headers["traceparent"] = continueTraceparent(call.traceparent);
  const token = peerToken(peer, call.tokenOf);
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  return headers;
}

/** the malformed-body fault (drift fails loud in the log) */
function malformedFault(detail: string): Fault {
  return { kind: "malformed", detail };
}

/** pull one wire face from a peer, parsed through the caller's schema.
 *  Dead, slow, or denied peers fail SOFT (a fault, logged, no throw) —
 *  the view of record stays ours; malformed peer bodies are faults
 *  too (drift fails loud in the log, never a silent empty view). */
export async function peerJson<T>(
  peer: BucklePeer,
  call: {
    seam: string;
    path: string;
    schema: z.ZodType<T>;
    tokenOf: TokenReader;
    timeoutMs: number;
    traceparent?: string;
  },
): Promise<PeerJsonResult<T>> {
  const sent = await httpSend(
    `${peer.url.replace(/\/$/, "")}${call.path}`,
    { headers: peerHeaders(peer, call) },
    call.timeoutMs,
  );
  if (!sent.ok) {
    logFault(call.seam, peer.url, sent.fault);
    return { ok: false, fault: sent.fault };
  }
  const body = await bodyJson(sent);
  if (!body.ok) {
    logFault(call.seam, peer.url, body.fault);
    return { ok: false, fault: body.fault };
  }
  const parsed = call.schema.safeParse(body.data);
  if (!parsed.success) {
    const fault = malformedFault(
      parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
    logFault(call.seam, peer.url, fault);
    return { ok: false, fault };
  }
  return { ok: true, data: parsed.data };
}
