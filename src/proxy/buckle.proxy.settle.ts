// buckle.proxy.settle.ts — the SETTLE surface: every leg's outcome
// maps to (a) the bus event that banks it and (b) the client
// response that answers it, exactly ONCE. Extracted from the
// pipeline (which keeps the loop composition); the three legs import
// these — a leg fetches, this module settles. The never-silent
// injection stamp and the hop verdict narrowing live here too: they
// are answer-shaping, not routing.
import { SERVED_BY_HEADER } from "../federation/buckle.federation.protocol.ts";
import type { HopOutcome } from "./buckle.proxy.hop.ts";
import { usageOf } from "./buckle.proxy.engine.ts";
import type { ServedOutcome } from "./buckle.proxy.outcome.ts";
import {
  failedEventOf,
  openedEventOf,
  servedEventOf,
  type FaultKindValue,
  type Leg,
} from "../events/buckle.events.bus.ts";
import { pick } from "../pick.ts";
import { problemResponse } from "../problem.ts";
import { LANE_ROUTE_HEADER } from "../lane.ts";
import type { ForwardCtx } from "./buckle.proxy.ctx.ts";

/** the never-silent stamp: every injected response names the rule
 *  that fired (id only — stanza content never surfaces) */
const CONTEXT_RULE_HEADER = "x-fleet-buckle-context-rule";

/** settle a SERVED outcome (the shared surface): the event rides the
 *  bus through the shared constructor (collectors bank usage +
 *  counters asynchronously from the face's point of view), raw bytes
 *  back out with the chain named */
export function settleServed(
  ctx: ForwardCtx,
  input: {
    model: string;
    leg: Leg;
    openedAt: number;
    peer?: string | undefined;
    injectedRule?: string | undefined;
    laneSlug?: string | undefined;
    outcome: ServedOutcome;
    /** streamed rides hand the LIVE upstream body here (the
     *  outcome's text is empty — usage tallies 0 by design) */
    upstream?: Response | undefined;
  },
): Response {
  const at = Date.now();
  ctx.bus.emit(
    servedEventOf({
      at,
      principal: ctx.principal,
      model: input.model,
      leg: input.leg,
      peer: input.peer,
      status: input.outcome.status,
      tokens: usageOf(input.outcome.text),
      latencyMs: at - input.openedAt,
    }),
  );
  return servedResponse(input.outcome, input.injectedRule, input.laneSlug, input.upstream);
}

/** settle a FAILED outcome (the shared half): the failed event rides
 *  the bus; leg-specific verdicts answer after this, locally narrowed */
export function settleFailed(
  ctx: ForwardCtx,
  input: {
    model: string;
    leg: Leg;
    openedAt: number;
    peer?: string | undefined;
    fault: FaultKindValue;
  },
): void {
  const at = Date.now();
  ctx.bus.emit(
    failedEventOf({
      at,
      principal: ctx.principal,
      model: input.model,
      leg: input.leg,
      peer: input.peer,
      fault: input.fault,
      latencyMs: at - input.openedAt,
    }),
  );
}

/** the opened half every leg shares — the ONE emit site for the kind */
export function emitOpened(ctx: ForwardCtx, model: string, at: number): void {
  ctx.bus.emit(openedEventOf({ at, principal: ctx.principal, principalKind: ctx.kind, model }));
}

function servedResponse(
  outcome: ServedOutcome,
  injectedRule?: string | undefined,
  laneSlug = "",
  upstream?: Response | undefined,
): Response {
  // the streamed ride answers with the LIVE upstream body — the
  // first token reaches the client as the upstream sends it
  const body = upstream?.body ?? outcome.text;
  return new Response(body, {
    status: outcome.status,
    headers: {
      "content-type": outcome.contentType,
      "cache-control": "no-store",
      [SERVED_BY_HEADER]: outcome.servedBy,
      ...pick(CONTEXT_RULE_HEADER, injectedRule),
      ...pick(LANE_ROUTE_HEADER, laneSlug === "" ? undefined : laneSlug),
    },
  });
}

/** a failed hop's client verdict — the outcome union mapped onto
 *  problem responses; the peer's 429 RELAYS (Retry-After), refusals
 *  name the peer, transport faults surface the fault KIND scrubbed */
export function verdictOf(
  peerLabel: string,
  outcome: Exclude<HopOutcome, { kind: "served" }>,
): Response {
  if (outcome.kind === "rate-limited")
    return problemResponse(
      "rate-limited",
      `peer ${peerLabel} rate-limited the hop`,
      outcome.detail,
      { "retry-after": String(outcome.retryAfterS) },
    );
  if (outcome.kind === "refused")
    return problemResponse("unavailable", `peer ${peerLabel} refused the hop`, outcome.detail);
  // outcome.kind === "fault" — the transport failed; the fault is
  // already logged at the seam, the client sees it NAMED, scrubbed
  return problemResponse(
    "unavailable",
    `peer ${peerLabel} ${outcome.fault.kind}`,
    `hop leg fault: ${outcome.fault.kind}`,
  );
}

/** a failed hop outcome narrowed into the taxonomy: the peer's 429
 *  RELAYS as a denial (retry-after rides the verdict), a refusal is
 *  a denial (status answered), a transport fault is itself */
export function faultKindOf(outcome: Exclude<HopOutcome, { kind: "served" }>): FaultKindValue {
  if (outcome.kind === "fault") return outcome.fault.kind;
  return "denied";
}
