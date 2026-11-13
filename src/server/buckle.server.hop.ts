// buckle.server.hop.ts — COMMIT 6: the federation HOP transport. A chat
// for a peer-origin model rides to that peer's /v1/chat/completions
// verbatim: body bytes untouched, the W3C trace CONTINUED (same trace
// id, new span), the peer token from its token_file PATH. The serving
// chain rides x-fleet-buckle-served-by — each buckle prepends its own label, so
// the client sees "b1,b3". The hop path rides x-fleet-buckle-hop-path; a hub
// already on it refuses re-entry (the loop guard — downstream-only by
// construction, guarded anyway). A 429 at the hop RELAYS to the client
// (rate-limited + Retry-After); any other peer refusal surfaces as an
// unavailable problem NAMING the peer — hop authz is operator-facing,
// never the client's fault.
import { z } from "zod";
import { continueTraceparent } from "./buckle.server.telemetry.ts";

/** the serving chain — head-first, one label per hop */
export const SERVED_BY_HEADER = "x-fleet-buckle-served-by";
/** comma hub labels the request has already ridden (loop guard) */
export const HOP_PATH_HEADER = "x-fleet-buckle-hop-path";
/** remaining chain budget in epoch ms — stamped by the ORIGIN buckle,
 *  carried VERBATIM by every relay: a chain can never outlive its
 *  origin's budget, however many hops deep it goes */
export const HOP_DEADLINE_HEADER = "x-fleet-buckle-deadline-ms";

/** bounded waits: a hanging peer must not hold the client forever */
export const HOP_TIMEOUT_MS = 120_000;

/** A downstream peer as the forward target: url + resolved token.
 *  safeParse'd at the hop boundary — a misconfigured hub entry fails
 *  loud, never rides half-formed. */
export const HopPeerSchema = z
  .object({
    label: z.string().min(1),
    url: z.url(),
    token: z.string().nullable(),
  })
  .strict();
export type HopPeer = z.output<typeof HopPeerSchema>;

/** The hop outcome, mapped by the caller into client-facing responses. */
export type HopOutcome =
  | {
      kind: "served";
      status: number;
      text: string;
      contentType: string;
      /** the full serving chain, this hub PREPENDED */
      servedBy: string;
    }
  | { kind: "rate-limited"; retryAfterS: number; detail: string }
  | { kind: "refused"; detail: string }
  | { kind: "unreachable"; detail: string };

/** Parse an inbound hop path (comma labels; empty/absent = fresh). */
export function hopPathOf(inbound: string | null): string[] {
  if (inbound === null) return [];
  return inbound
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The loop guard: our own label already on the path = re-entry. */
export function wouldLoop(path: string[], self: string): boolean {
  return path.includes(self);
}

/** Inbound chain deadline (epoch ms). Malformed/absent = null —
 *  garbage never propagates, the origin budget takes over. */
export function hopDeadlineOf(inbound: string | null): number | null {
  if (inbound === null) return null;
  const n = Number(inbound);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Forward one chat body to the peer. NEVER throws — every failure is
 *  a named outcome. `inboundPath` is the path WE rode in on (fresh at
 *  a head buckle); the peer receives it plus OUR label. `deadlineMs`
 *  is the chain budget (null at an origin: we stamp our own and the
 *  chain is bounded by it from here down). */
export async function hopChat(
  self: string,
  peer: HopPeer,
  bodyText: string,
  traceparent: string,
  inboundPath: string[],
  deadlineMs: number | null,
): Promise<HopOutcome> {
  const budget = deadlineMs === null ? HOP_TIMEOUT_MS : deadlineMs - Date.now();
  if (budget <= 0)
    return { kind: "refused", detail: "hop deadline exhausted" };
  const deadline = deadlineMs ?? Date.now() + HOP_TIMEOUT_MS;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    traceparent: continueTraceparent(traceparent),
    [HOP_PATH_HEADER]: [...inboundPath, self].join(","),
    [HOP_DEADLINE_HEADER]: String(deadline),
  };
  if (peer.token !== null) headers["authorization"] = `Bearer ${peer.token}`;
  let upstream: Response;
  try {
    upstream = await fetch(
      `${peer.url.replace(/\/$/, "")}/v1/chat/completions`,
      {
        method: "POST",
        headers,
        body: bodyText,
        // never longer than the chain budget, never longer than HOP_TIMEOUT_MS
        signal: AbortSignal.timeout(Math.min(HOP_TIMEOUT_MS, budget)),
      },
    );
  } catch (e) {
    return {
      kind: "unreachable",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  const text = await upstream.text();
  if (upstream.status === 429) {
    // relay the peer's verdict: the client must see Retry-After
    const retryHeader = upstream.headers.get("retry-after");
    const retryAfterS = Number(retryHeader ?? "1");
    return {
      kind: "rate-limited",
      retryAfterS: Number.isFinite(retryAfterS) && retryAfterS > 0 ? retryAfterS : 1,
      detail: text.slice(0, 200),
    };
  }
  if (!(upstream.status >= 200 && upstream.status < 300)) {
    return {
      kind: "refused",
      detail: `status ${String(upstream.status)} — ${text.slice(0, 200)}`,
    };
  }
  const chain = (upstream.headers.get(SERVED_BY_HEADER) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return {
    kind: "served",
    status: upstream.status,
    text,
    contentType: upstream.headers.get("content-type") ?? "application/json",
    // serving order is head-first: OUR label, then whoever served below us
    servedBy: [self, ...chain].join(","),
  };
}
