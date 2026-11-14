// proxy/buckle.proxy.pipeline.ts — the MITM loop. The model resolves in
// the PRINCIPAL'S federated view (own rows + peers their grant admits):
// a provider-origin model forwards to OUR engine; a buckle-origin
// model HOPS to that peer verbatim (the peer re-checks models.use
// against its own registry — per-hop grants). Drift fails loud
// (problem+json 404). Bodies ride UNTOUCHED (raw bytes in, raw bytes
// out); the trace CONTINUES; the serving chain rides x-fleet-buckle-served-by;
// every request counts in /metrics. This module is the PIPELINE —
// the two legs live in buckle.proxy.hop.ts and buckle.proxy.engine.ts;
// the SERVED mapping is the ONE shared surface between them.
import { z } from "zod";
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { peerToken, type TokenReader } from "../federation/buckle.federation.peer.ts";
import {
  HOP_DEADLINE_HEADER,
  HOP_PATH_HEADER,
  type HopRide,
  HopRideSchema,
  SERVED_BY_HEADER,
  HopPeerSchema,
  hopDeadlineOf,
  hopPathOf,
  wouldLoop,
} from "../federation/buckle.federation.protocol.ts";
import { buildFederatedCatalog } from "../catalog/buckle.catalog.view.ts";
import { hopChat, type HopOutcome } from "./buckle.proxy.hop.ts";
import { engineChat, usageOf } from "./buckle.proxy.engine.ts";
import {
  failedEventOf,
  openedEventOf,
  servedEventOf,
  type EventBus,
  type FaultKindValue,
  type Leg,
} from "../events/buckle.events.bus.ts";
import { parseJson } from "../fault.ts";
import { pick } from "../pick.ts";
import { problemResponse } from "../problem.ts";
import { ContextFacts, inertJudge, type ContextJudge } from "../context/buckle.context.judge.ts";

export { problemResponse };

/** we read ONLY the model id out of the chat body — everything else
 *  rides verbatim (the engine owns its own face, never re-schematized) */
const ChatBody = z.object({ model: z.string().min(1) }).passthrough();

function modelOf(raw: string): string | null {
  const json = parseJson(raw);
  if (!json.ok) return null;
  const parsed = ChatBody.safeParse(json.data);
  return parsed.success ? parsed.data.model : null;
}

/** the SERVED outcome both legs share: raw bytes back out, content
 *  type preserved, the serving chain named. ONE surface — the legs
 *  differ only in how the outcome is fetched, never in how it maps.
 *  zod-derived (the type law) and structurally what both legs'
 *  outcome schemas emit for kind="served". */
export const ServedOutcomeSchema = z
  .object({
    kind: z.literal("served"),
    status: z.number().int(),
    text: z.string(),
    contentType: z.string(),
    servedBy: z.string(),
  })
  .strict();
type ServedOutcome = z.output<typeof ServedOutcomeSchema>;

/** a chat body we may prepend into: messages is an array, everything
 *  else rides passthrough (the engine owns its own face) */
const InjectableChatBody = z.object({ messages: z.array(z.unknown()) }).passthrough();

/** the ONE sanctioned body rewrite: the stanza becomes the FIRST
 *  system message (merged ahead of any existing system prefix). A
 *  non-chat-shaped body is returned untouched — injection never
 *  corrupts what it does not understand. */
function injectedBodyOf(raw: string, stanza: string): string {
  const json = parseJson(raw);
  if (!json.ok) return raw;
  const body = InjectableChatBody.safeParse(json.data);
  if (!body.success) return raw;
  body.data.messages.unshift({ role: "system", content: stanza });
  return JSON.stringify(body.data);
}

function servedResponse(outcome: ServedOutcome): Response {
  return new Response(outcome.text, {
    status: outcome.status,
    headers: {
      "content-type": outcome.contentType,
      "cache-control": "no-store",
      [SERVED_BY_HEADER]: outcome.servedBy,
    },
  });
}

/** the FORWARDING CONTEXT — the request-independent half of every
 *  forward: who is asking, under which settings, with which
 *  observability and secret reader. The factory's real job: resolve
 *  the principal's KIND from the registry ONCE (absent row = no kind
 *  — the tracker renders the row without one). Factory-typed (the
 *  codebase idiom for live values: ReturnType of the one
 *  constructor — never a fake z.custom parse). */
export function createForwardCtx(parts: {
  settings: BuckleSettings;
  bus: EventBus;
  judge?: ContextJudge;
  principal: string;
  tokenOf: TokenReader;
}) {
  const kind = parts.settings.access?.principals.find(
    (p) => p.id === parts.principal,
  )?.kind;
  // the judge defaults INERT: no injection unless a policy says so
  return { judge: inertJudge, ...parts, kind } as const;
}
type ForwardCtx = ReturnType<typeof createForwardCtx>;

/** settle a SERVED outcome (the shared surface): the event rides the
 *  bus through the shared constructor (collectors bank usage +
 *  counters asynchronously from the face's point of view), raw bytes
 *  back out with the chain named */
function settleServed(
  ctx: ForwardCtx,
  input: {
    model: string;
    leg: Leg;
    openedAt: number;
    peer?: string | undefined;
    outcome: ServedOutcome;
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
  return servedResponse(input.outcome);
}

/** settle a FAILED outcome (the shared half): the failed event rides
 *  the bus; leg-specific verdicts answer after this, locally narrowed */
function settleFailed(
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

/** the opened half both legs share — the ONE emit site for the kind */
function emitOpened(ctx: ForwardCtx, model: string, at: number): void {
  ctx.bus.emit(
    openedEventOf({ at, principal: ctx.principal, principalKind: ctx.kind, model }),
  );
}

export async function forwardChat(
  ctx: ForwardCtx,
  req: Request,
  traceparent: string,
): Promise<Response> {
  const { settings, principal, tokenOf } = ctx;
  // 1 — the body must name a model (drift fails loud); the raw bytes
  //     are read ONCE and ride untouched from here on
  let raw = await req.text();
  const model = modelOf(raw);
  if (model === null)
    return problemResponse("validation", "chat body missing model");

  // 2 — the loop guard fires BEFORE any peer traffic: a hub already on
  //     the hop path refuses re-entry, no matter the model
  const inboundPath = hopPathOf(req.headers.get(HOP_PATH_HEADER));
  if (wouldLoop(inboundPath, settings.hub.label))
    return problemResponse(
      "unavailable",
      "federation loop refused",
      `${settings.hub.label} is already on ${HOP_PATH_HEADER}: ${inboundPath.join(",")}`,
    );

  // 2.5 — CONTEXT INJECTION (the ONE sanctioned body mutation):
  //      ORIGINATING requests only (a hop arrival already had its
  //      chance at its own ingress — an empty path header proves
  //      origin); the judge gets the facts needed to decide (who,
  //      what they asked — the body's start — which model) and TRUE
  //      is the default: the body rides byte-identical, verbatim
  if (inboundPath.length === 0) {
    const verdict = ctx.judge(
      ContextFacts.parse({
        route: "chat",
        principal,
        ...pick("principalKind", ctx.kind),
        model,
        bodyStart: raw.slice(0, 512),
        ...pick("repo", req.headers.get("x-fleet-repo")),
      }),
    );
    if (verdict !== true) raw = injectedBodyOf(raw, verdict.system);
  }

  // 3 — the chain budget: an already-exhausted deadline refuses before
  //     ANY peer traffic — a chain can never outlive its origin's budget
  const deadline = hopDeadlineOf(req.headers.get(HOP_DEADLINE_HEADER));
  if (deadline !== null && Date.now() >= deadline)
    return problemResponse(
      "unavailable",
      "hop deadline exhausted",
      `${settings.hub.label} reached with ${HOP_DEADLINE_HEADER} in the past`,
    );

  // 4 — resolve in the principal's FEDERATED view: a peer model a
  //     grant does not admit is indistinguishable from an unknown
  //     model (no leak)
  const catalog = await buildFederatedCatalog(settings, principal, tokenOf, traceparent);
  const known = catalog.models.find((m) => m.id === model);
  if (known === undefined)
    return problemResponse(
      "not-found",
      `model ${model} is not served by this buckle`,
    );

  // 5 — the leg: buckle-origin hops, provider-origin rides our engine.
  //     The RIDE is the request's protocol state, validated ONCE —
  //     body, continued trace, inbound path, chain budget
  const ride = HopRideSchema.parse({
    body: raw,
    traceparent,
    path: inboundPath,
    deadline,
  });
  return known.origin.kind === "buckle"
    ? await serveHop(ctx, ride, known.origin.label, model)
    : await serveEngine(ctx, ride, model);
}

/** a failed hop's client verdict — the outcome union mapped onto
 *  problem responses; the peer's 429 RELAYS (Retry-After), refusals
 *  name the peer, transport faults surface the fault KIND scrubbed */
function verdictOf(peerLabel: string, outcome: Exclude<HopOutcome, { kind: "served" }>): Response {
  if (outcome.kind === "rate-limited")
    return problemResponse(
      "rate-limited",
      `peer ${peerLabel} rate-limited the hop`,
      outcome.detail,
      { "retry-after": String(outcome.retryAfterS) },
    );
  if (outcome.kind === "refused")
    return problemResponse(
      "unavailable",
      `peer ${peerLabel} refused the hop`,
      outcome.detail,
    );
  // outcome.kind === "fault" — the transport failed; the fault is
  // already logged at the seam, the client sees it NAMED, scrubbed
  return problemResponse(
    "unavailable",
    `peer ${peerLabel} ${outcome.fault.kind}`,
    `hop leg fault: ${outcome.fault.kind}`,
  );
}

/** the peer leg: buckle-origin model → that peer, verbatim */
async function serveHop(
  ctx: ForwardCtx,
  ride: HopRide,
  peerLabel: string,
  model: string,
): Promise<Response> {
  const { settings, tokenOf } = ctx;
  const peer = settings.hubs?.[peerLabel];
  if (peer === undefined)
    return problemResponse(
      "unavailable",
      `peer ${peerLabel} is no longer configured`,
    );
  const hopPeer = HopPeerSchema.safeParse({
    label: peerLabel,
    url: peer.url,
    token: peerToken(peer, tokenOf),
  });
  if (!hopPeer.success)
    return problemResponse(
      "unavailable",
      `peer ${peerLabel} is misconfigured`,
      hopPeer.error.issues.map((i) => i.path.join(".")).join(", "),
    );

  const openedAt = Date.now();
  emitOpened(ctx, model, openedAt);
  const outcome = await hopChat(
    settings.hub.label,
    hopPeer.data,
    ride,
    settings.timeouts.hop_ms,
  );
  if (outcome.kind === "served")
    return settleServed(ctx, {
      model, leg: "hop", openedAt, peer: peerLabel, outcome,
    });
  settleFailed(ctx, {
    model, leg: "hop", openedAt, peer: peerLabel, fault: faultKindOf(outcome),
  });
  return verdictOf(peerLabel, outcome);
}

/** a failed hop outcome narrowed into the taxonomy: the peer's 429
 *  RELAYS as a denial (retry-after rides the verdict), a refusal is
 *  a denial (status answered), a transport fault is itself */
function faultKindOf(
  outcome: Exclude<HopOutcome, { kind: "served" }>,
): FaultKindValue {
  if (outcome.kind === "fault") return outcome.fault.kind;
  return "denied";
}

/** the engine leg: provider-origin model → OUR litellm */
async function serveEngine(
  ctx: ForwardCtx,
  ride: HopRide,
  model: string,
): Promise<Response> {
  const openedAt = Date.now();
  emitOpened(ctx, model, openedAt);
  const outcome = await engineChat(ctx.settings, ride.body, ride.traceparent, ctx.tokenOf);
  if (outcome.kind === "served")
    return settleServed(ctx, { model, leg: "engine", openedAt, outcome });
  settleFailed(ctx, {
    model, leg: "engine", openedAt, fault: outcome.fault.kind,
  });
  // outcome.kind === "fault" — named, already logged at the seam
  return problemResponse(
    "unavailable",
    `engine ${outcome.fault.kind}`,
    `engine leg fault: ${outcome.fault.kind}`,
  );
}
