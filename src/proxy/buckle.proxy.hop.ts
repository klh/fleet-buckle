// buckle.proxy.hop.ts — the federation HOP leg of the forward loop:
// a chat for a peer-origin model rides to that peer's
// /v1/chat/completions VERBATIM (body bytes untouched, the W3C trace
// continued, the peer token from its token_file PATH). The wire
// protocol itself (chain, loop guard, deadline) lives in
// federation.protocol — the zero-import leaf, ported from the old
// hop.ts. A 429 at the hop RELAYS to the client (rate-limited +
// Retry-After); any other peer failure is a typed fault, surfaced as
// an unavailable problem NAMING the peer — hop authz is
// operator-facing, never the client's fault.
import { z } from "zod";
import { Fault } from "../schemas/buckle.fault.zod.ts";
import { bodyText as readBody, httpSend, logFault } from "../fault.ts";
import {
  HOP_DEADLINE_HEADER,
  HOP_PATH_HEADER,
  type HopPeer,
  SERVED_BY_HEADER,
} from "../federation/buckle.federation.protocol.ts";
import { continueTraceparent } from "../live/buckle.live.trace.ts";

/** the hop outcome (zod union), mapped by the caller into
 *  client-facing responses — every type zod-derived (the type law);
 *  every failure decomposed onto the one Fault taxonomy */
export const HopOutcome = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("served"),
      status: z.number().int(),
      text: z.string(),
      contentType: z.string(),
      /** the full serving chain, this hub PREPENDED */
      servedBy: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rate-limited"),
      retryAfterS: z.number(),
      detail: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("refused"), detail: z.string() }).strict(),
  z.object({ kind: z.literal("fault"), fault: Fault }).strict(),
]);
export type HopOutcome = z.output<typeof HopOutcome>;

/** a completed hop's answer: 429 relays (the client must see
 *  Retry-After), any other non-2xx refuses with the status NAMED, a
 *  2xx serves — raw text back, OUR label prepended to the chain the
 *  peer already reported (head-first order). */
function respondOf(self: string, sent: Response, text: string): HopOutcome {
  if (sent.status === 429) {
    // relay the peer's verdict: the client must see Retry-After
    const retryAfterS = Number(sent.headers.get("retry-after") ?? "1");
    return {
      kind: "rate-limited",
      retryAfterS:
        Number.isFinite(retryAfterS) && retryAfterS > 0 ? retryAfterS : 1,
      detail: text.slice(0, 200),
    };
  }
  if (!(sent.status >= 200 && sent.status < 300))
    return {
      kind: "refused",
      detail: `status ${String(sent.status)} — ${text.slice(0, 200)}`,
    };
  // serving order is head-first: OUR label, then whoever served below us
  const chain = sent.headers
    .get(SERVED_BY_HEADER)
    ?.split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0) ?? [];
  return {
    kind: "served",
    status: sent.status,
    text,
    contentType: sent.headers.get("content-type") ?? "application/json",
    servedBy: [self, ...chain].join(","),
  };
}

/** forward one chat body to the peer. NEVER throws — every failure is
 *  a named outcome. `inboundPath` is the path WE rode in on (fresh at
 *  a head buckle); the peer receives it plus OUR label. `deadlineMs`
 *  is the chain budget (null at an origin: we stamp our own and the
 *  chain is bounded by it from here down). `timeoutMs` is
 *  settings.timeouts.hop_ms — the chain budget can only TIGHTEN it. */
export async function hopChat(
  self: string,
  peer: HopPeer,
  bodyText: string,
  traceparent: string,
  inboundPath: string[],
  deadlineMs: number | null,
  timeoutMs: number,
): Promise<HopOutcome> {
  const budget = deadlineMs === null ? timeoutMs : deadlineMs - Date.now();
  if (budget <= 0)
    return { kind: "refused", detail: "hop deadline exhausted" };
  const deadline = deadlineMs ?? Date.now() + timeoutMs;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    traceparent: continueTraceparent(traceparent),
    [HOP_PATH_HEADER]: [...inboundPath, self].join(","),
    [HOP_DEADLINE_HEADER]: String(deadline),
  };
  if (peer.token !== null) headers["authorization"] = `Bearer ${peer.token}`;

  const sent = await httpSend(
    `${peer.url.replace(/\/$/, "")}/v1/chat/completions`,
    {
      method: "POST",
      headers,
      body: bodyText,
    },
    // never longer than the chain budget, never longer than the hop knob
    Math.min(timeoutMs, budget),
  );
  if (!sent.ok) {
    logFault("proxy.hop", peer.url, sent.fault);
    return { kind: "fault", fault: sent.fault };
  }
  const body = await readBody(sent);
  if (!body.ok) {
    logFault("proxy.hop", peer.url, body.fault);
    return { kind: "fault", fault: body.fault };
  }
  return respondOf(self, sent.response, body.text);
}
