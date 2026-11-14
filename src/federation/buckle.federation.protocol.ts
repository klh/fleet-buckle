// buckle.federation.protocol.ts — the DOWNSTREAM hop protocol: the
// wire contract every fleet-buckle speaks to its peers. Ported from
// old buckle's hop.ts as the zero-import leaf it was there (used by 6
// modules, imported none): the serving chain, the loop guard, and the
// chain deadline. The old file's hop ATTRIBUTION (origin-vs-relay
// billing, baggage allowlist) is deliberately NOT here — it rides the
// future ledger port (doctrine #2), not the transport.
import { z } from "zod";

/** the serving chain — head-first, one label per hop; each buckle
 *  PREPENDS its own label so the client sees "b1,b3" */
export const SERVED_BY_HEADER = "x-fleet-buckle-served-by";

/** comma hub labels the request has already ridden (loop guard) */
export const HOP_PATH_HEADER = "x-fleet-buckle-hop-path";

/** remaining chain budget in epoch ms — stamped by the ORIGIN buckle,
 *  carried VERBATIM by every relay: a chain can never outlive its
 *  origin's budget, however many hops deep it goes */
export const HOP_DEADLINE_HEADER = "x-fleet-buckle-deadline-ms";

/** parse an inbound hop path (comma labels; empty/absent = fresh) */
export function hopPathOf(inbound: string | null): string[] {
  if (inbound === null) return [];
  return inbound
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** the loop guard: our own label already on the path = re-entry */
export function wouldLoop(path: string[], self: string): boolean {
  return path.includes(self);
}

/** inbound chain deadline (epoch ms). Malformed/absent = null —
 *  garbage never propagates; the origin budget takes over. */
export function hopDeadlineOf(inbound: string | null): number | null {
  if (inbound === null) return null;
  const n = Number(inbound);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** a downstream peer as a forward target: url + resolved token.
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
