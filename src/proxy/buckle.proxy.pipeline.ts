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
import { peerToken } from "../federation/buckle.federation.peer.ts";
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
  injectedEventOf,
  openedEventOf,
  servedEventOf,
  type FaultKindValue,
  type Leg,
} from "../events/buckle.events.bus.ts";
import { parseJson } from "../fault.ts";
import { pick } from "../pick.ts";
import { problemResponse } from "../problem.ts";
import { ContextFacts } from "../context/buckle.context.judge.ts";
import { ENGINE_PATH, injectedBodyOf, pinnedBodyOf } from "../context/buckle.context.inject.ts";
import type { ForwardCtx } from "./buckle.proxy.ctx.ts";
import { LANE_ROUTE_HEADER } from "../lane.ts";

/** the never-silent stamp: every injected response names the rule
 *  that fired (id only — stanza content never surfaces) */
const CONTEXT_RULE_HEADER = "x-fleet-buckle-context-rule";

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

export type { ChatRoute } from "../context/buckle.context.inject.ts";

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
    injectedRule?: string | undefined;
    laneSlug?: string | undefined;
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
  return servedResponse(input.outcome, input.injectedRule, input.laneSlug);
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
  ctx.bus.emit(openedEventOf({ at, principal: ctx.principal, principalKind: ctx.kind, model }));
}

function servedResponse(
  outcome: ServedOutcome,
  injectedRule?: string | undefined,
  laneSlug = "",
): Response {
  return new Response(outcome.text, {
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

/** what the legs need beyond ctx+ride: the wire face asked + the
 *  attribution that survived ingress (the fired rule's id, the lane
 *  slug) — ONE bundle, no trailing parameter drift */
export const LegStampSchema = z.object({
  route: z.enum(["chat", "messages"]),
  laneSlug: z.string(),
  injectedRule: z.string().optional(),
});
type LegStamp = z.output<typeof LegStampSchema>;

/** the LANE PIN: a /w/<slug> launch URL whose slug HAS a row pins
 *  the model (the pin wins over the body). A slug with NO row is
 *  pure W1 attribution — any slug rides, rows only pin */
function lanePinnedBody(settings: BuckleSettings, laneSlug: string, body: string): string {
  if (laneSlug === "") return body;
  const row = settings["lanes"]?.find((l: { id: string; model: string }) => l.id === laneSlug);
  return row === undefined ? body : pinnedBodyOf(body, row.model);
}

/** pre-body refusals that need NO catalog: loop guard, then the
 *  chain budget — both fire BEFORE any peer traffic (a chain can
 *  never outlive its origin's budget) */
function earlyRefusal(settings: BuckleSettings, req: Request): Response | null {
  const inboundPath = hopPathOf(req.headers.get(HOP_PATH_HEADER));
  if (wouldLoop(inboundPath, settings.hub.label))
    return problemResponse(
      "unavailable",
      "federation loop refused",
      `${settings.hub.label} is already on ${HOP_PATH_HEADER}: ${inboundPath.join(",")}`,
    );
  const deadline = hopDeadlineOf(req.headers.get(HOP_DEADLINE_HEADER));
  if (deadline !== null && Date.now() >= deadline)
    return problemResponse(
      "unavailable",
      "hop deadline exhausted",
      `${settings.hub.label} reached with ${HOP_DEADLINE_HEADER} in the past`,
    );
  return null;
}

/** CONTEXT INJECTION (the ONE sanctioned body mutation): ORIGINATING
 *  requests only (a hop arrival already had its chance at its own
 *  ingress — an empty path header proves origin); the judge gets the
 *  facts needed to decide, TRUE is the default (verbatim ride). A
 *  fired rule is NEVER silent: the event banks the counter, the
 *  verdict's id stamps the response header */
/** the ask under inspection: which model the body names + the raw
 *  bytes (in and — possibly injected — back out) */
export const BodyAskSchema = z.object({ model: z.string(), raw: z.string() });
export const BodyRideSchema = z.object({ raw: z.string(), injectedRule: z.string().optional() });
type BodyAsk = z.output<typeof BodyAskSchema>;
type BodyRide = z.output<typeof BodyRideSchema>;

function injectContext(ctx: ForwardCtx, req: Request, stamp: LegStamp, ask: BodyAsk): BodyRide {
  if (hopPathOf(req.headers.get(HOP_PATH_HEADER)).length > 0) return { raw: ask.raw };
  const verdict = ctx.judge(
    ContextFacts.parse({
      route: stamp.route,
      principal: ctx.principal,
      ...pick("principalKind", ctx.kind),
      ...pick("groups", ctx.groups),
      model: ask.model,
      bodyStart: ask.raw.slice(0, 512),
      ...pick("repo", req.headers.get("x-fleet-repo")),
      // the PATH slug is the attribution contract; the header is the fallback
      ...pick("lane", stamp.laneSlug || req.headers.get("x-fleet-lane")),
      ...pick("work", req.headers.get("x-fleet-work")),
    }),
  );
  if (verdict === true) return { raw: ask.raw };
  ctx.bus.emit(
    injectedEventOf({
      at: Date.now(),
      principal: ctx.principal,
      model: ask.model,
      rule: verdict.rule,
    }),
  );
  return { raw: injectedBodyOf(ask.raw, verdict.system, stamp.route), injectedRule: verdict.rule };
}

export async function forwardChat(
  ctx: ForwardCtx,
  req: Request,
  traceparent: string,
  stamp: LegStamp,
): Promise<Response> {
  const { settings, principal, tokenOf } = ctx;
  // 1 — the body must name a model (drift fails loud); the raw bytes
  //     are read ONCE and ride untouched from here on
  let raw = lanePinnedBody(settings, stamp.laneSlug, await req.text());
  const model = modelOf(raw);
  if (model === null) return problemResponse("validation", "chat body missing model");

  // 2 — loop guard + chain budget, before any peer traffic; then the
  //     ONE sanctioned body mutation on originating requests
  const refused = earlyRefusal(settings, req);
  if (refused !== null) return refused;
  const injected = injectContext(ctx, req, stamp, { model, raw });
  raw = injected.raw;
  // the sealed stamp: whatever attribution survived ingress rides the
  // legs and stamps the served response (never-silent injection)
  const sealed: LegStamp = { ...stamp, injectedRule: injected.injectedRule };

  // 3 — resolve in the principal's FEDERATED view: a peer model a
  //     grant does not admit is indistinguishable from an unknown
  //     model (no leak)
  const catalog = await buildFederatedCatalog(settings, principal, tokenOf, traceparent);
  const known = catalog.models.find((m) => m.id === model);
  if (known === undefined)
    return problemResponse("not-found", `model ${model} is not served by this buckle`);

  // 4 — the leg: buckle-origin hops, provider-origin rides our engine.
  //     The RIDE is the request's protocol state, validated ONCE —
  //     body, continued trace, inbound path, chain budget
  const ride = HopRideSchema.parse({
    body: raw,
    traceparent,
    path: hopPathOf(req.headers.get(HOP_PATH_HEADER)),
    deadline: hopDeadlineOf(req.headers.get(HOP_DEADLINE_HEADER)),
  });
  return known.origin.kind === "buckle"
    ? await serveHop(ctx, ride, sealed, { peerLabel: known.origin.label, model })
    : await serveEngine(ctx, ride, model, sealed);
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
    return problemResponse("unavailable", `peer ${peerLabel} refused the hop`, outcome.detail);
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
  stamp: LegStamp,
  target: { peerLabel: string; model: string },
): Promise<Response> {
  const { settings, tokenOf } = ctx;
  const { peerLabel, model } = target;
  const peer = settings.hubs?.[peerLabel];
  if (peer === undefined)
    return problemResponse("unavailable", `peer ${peerLabel} is no longer configured`);
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
  const outcome = await hopChat({
    self: settings.hub.label,
    peer: hopPeer.data,
    ride,
    timeoutMs: settings.timeouts.hop_ms,
    urlPath: ENGINE_PATH[stamp.route],
  });
  if (outcome.kind === "served")
    return settleServed(ctx, {
      model,
      leg: "hop",
      openedAt,
      peer: peerLabel,
      injectedRule: stamp.injectedRule,
      laneSlug: stamp.laneSlug,
      outcome,
    });
  settleFailed(ctx, {
    model,
    leg: "hop",
    openedAt,
    peer: peerLabel,
    fault: faultKindOf(outcome),
  });
  return verdictOf(peerLabel, outcome);
}

/** a failed hop outcome narrowed into the taxonomy: the peer's 429
 *  RELAYS as a denial (retry-after rides the verdict), a refusal is
 *  a denial (status answered), a transport fault is itself */
function faultKindOf(outcome: Exclude<HopOutcome, { kind: "served" }>): FaultKindValue {
  if (outcome.kind === "fault") return outcome.fault.kind;
  return "denied";
}

/** the engine leg: provider-origin model → OUR litellm */
async function serveEngine(
  ctx: ForwardCtx,
  ride: HopRide,
  model: string,
  stamp: LegStamp,
): Promise<Response> {
  const openedAt = Date.now();
  emitOpened(ctx, model, openedAt);
  // the GUI-legible attribution stamp (lane + principal) — the tags
  // litellm request logs and the policy engine read
  const fleetTags = [
    ...(stamp.laneSlug !== "" ? [`lane:${stamp.laneSlug}`] : []),
    `principal:${ctx.principal}`,
  ].join(",");
  const outcome = await engineChat({
    settings: ctx.settings,
    raw: ride.body,
    traceparent: ride.traceparent,
    tokenOf: ctx.tokenOf,
    enginePath: ENGINE_PATH[stamp.route],
    fleetTags,
  });
  if (outcome.kind === "served")
    return settleServed(ctx, {
      model,
      leg: "engine",
      openedAt,
      injectedRule: stamp.injectedRule,
      laneSlug: stamp.laneSlug,
      outcome,
    });
  settleFailed(ctx, {
    model,
    leg: "engine",
    openedAt,
    fault: outcome.fault.kind,
  });
  // outcome.kind === "fault" — named, already logged at the seam
  return problemResponse(
    "unavailable",
    `engine ${outcome.fault.kind}`,
    `engine leg fault: ${outcome.fault.kind}`,
  );
}
