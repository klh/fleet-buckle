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
import { continueTraceparent } from "../live/buckle.live.trace.ts";

/** reads a key/token file (secrets are paths, never values); the ONE
 *  implementation lives in src/settings.ts (readToken) */
export type TokenReader = (file: string) => string | null;

/** the peer's federation token (its token_file) — null when unset or
 *  unreadable; one read shape shared by every peer-facing site */
export function peerToken(peer: BucklePeer, tokenOf: TokenReader): string | null {
  return peer.token_file !== undefined ? tokenOf(peer.token_file) : null;
}

export type PeerJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; fault: Fault };

/** pull one wire face from a peer, parsed through the caller's schema.
 *  Dead, slow, or denied peers fail SOFT (a fault, logged, no throw) —
 *  the view of record stays ours; malformed peer bodies are faults
 *  too (drift fails loud in the log, never a silent empty view). */
export async function peerJson<T>(
  seam: string,
  peer: BucklePeer,
  path: string,
  schema: z.ZodType<T>,
  tokenOf: TokenReader,
  timeoutMs: number,
  traceparent?: string,
): Promise<PeerJsonResult<T>> {
  const headers: Record<string, string> = {};
  if (traceparent !== undefined)
    headers["traceparent"] = continueTraceparent(traceparent);
  const token = peerToken(peer, tokenOf);
  if (token !== null) headers["authorization"] = `Bearer ${token}`;

  const sent = await httpSend(
    `${peer.url.replace(/\/$/, "")}${path}`,
    { headers },
    timeoutMs,
  );
  if (!sent.ok) {
    logFault(seam, peer.url, sent.fault);
    return { ok: false, fault: sent.fault };
  }
  const body = await bodyJson(sent);
  if (!body.ok) {
    logFault(seam, peer.url, body.fault);
    return { ok: false, fault: body.fault };
  }
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    const fault: Fault = {
      kind: "malformed",
      detail: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
    logFault(seam, peer.url, fault);
    return { ok: false, fault };
  }
  return { ok: true, data: parsed.data };
}
