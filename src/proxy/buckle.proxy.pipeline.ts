// proxy/buckle.proxy.pipeline.ts — the MITM loop. The model resolves in
// the PRINCIPAL'S federated view (own rows + peers their grant admits):
// a provider-origin model forwards to OUR engine (or the BYOC leg when
// the provider rides the caller's own credential); a buckle-origin
// model HOPS to that peer verbatim (the peer re-checks models.use
// against its own registry — per-hop grants). Drift fails loud
// (problem+json 404). Bodies ride UNTOUCHED (raw bytes in, raw bytes
// out); the trace CONTINUES; the serving chain rides x-fleet-buckle-served-by;
// every request counts in /metrics. This module is the LOOP — the
// legs live in buckle.proxy.{hop,engine,userleg}.ts, the settle
// surface in buckle.proxy.settle.ts, the model gate in
// buckle.proxy.gate.ts, the shared outcome in buckle.proxy.outcome.ts.
import { z } from "zod";
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { peerToken } from "../federation/buckle.federation.peer.ts";
import {
  HOP_DEADLINE_HEADER,
  HOP_PATH_HEADER,
  type HopRide,
  HopRideSchema,
  HopPeerSchema,
  hopDeadlineOf,
  hopPathOf,
  wouldLoop,
} from "../federation/buckle.federation.protocol.ts";
import { hopChat } from "./buckle.proxy.hop.ts";
import { engineChat } from "./buckle.proxy.engine.ts";
import { userChat } from "./buckle.proxy.userleg.ts";
import {
  emitOpened,
  faultKindOf,
  settleFailed,
  settleServed,
  verdictOf,
} from "./buckle.proxy.settle.ts";
import { resolveModelGate } from "./buckle.proxy.gate.ts";
import { injectedEventOf } from "../events/buckle.events.bus.ts";
import { parseJson } from "../fault.ts";
import { pick } from "../pick.ts";
import { problemResponse } from "../problem.ts";
import { ServedOutcomeSchema } from "./buckle.proxy.outcome.ts";
import { ContextFacts } from "../context/buckle.context.judge.ts";
import { ENGINE_PATH, injectedBodyOf, pinnedBodyOf } from "../context/buckle.context.inject.ts";
import type { ForwardCtx } from "./buckle.proxy.ctx.ts";

export { problemResponse };
// the ONE served outcome (buckle.proxy.outcome.ts) — re-exported for
// the colocated pipeline tests; the legs import it from the leaf
export { ServedOutcomeSchema };

/** we read ONLY the model id out of the chat body — everything else
 *  rides verbatim (the engine owns its own face, never re-schematized) */
const ChatBody = z.object({ model: z.string().min(1) }).passthrough();

function modelOf(raw: string): string | null {
  const json = parseJson(raw);
  if (!json.ok) return null;
  const parsed = ChatBody.safeParse(json.data);
  return parsed.success ? parsed.data.model : null;
}

export type { ChatRoute } from "../context/buckle.context.inject.ts";

/** what the legs need beyond ctx+ride: the wire face asked + the
 *  attribution that survived ingress (the fired rule's id, the lane
 *  slug) — ONE bundle, no trailing parameter drift */
const _LegStampSchema = z.object({
  route: z.enum(["chat", "messages"]),
  laneSlug: z.string(),
  injectedRule: z.string().optional(),
});
type LegStamp = z.output<typeof _LegStampSchema>;

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
const _BodyAskSchema = z.object({ model: z.string(), raw: z.string() });
const _BodyRideSchema = z.object({ raw: z.string(), injectedRule: z.string().optional() });
type BodyAsk = z.output<typeof _BodyAskSchema>;
type BodyRide = z.output<typeof _BodyRideSchema>;

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
  const { settings } = ctx;
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

  // 3 + 3.5 — resolve in the principal's FEDERATED view, then the
  //     BYOC gate (both refusals decompose to problems)
  const gate = await resolveModelGate(ctx, { model, traceparent });
  if (gate.kind === "refused") return gate.response;

  // 4 — the leg: buckle-origin hops, provider-origin rides our engine
  //     (or the BYOC leg for user_token providers). The RIDE is the
  //     request's protocol state, validated ONCE — body, continued
  //     trace, inbound path, chain budget
  const ride = HopRideSchema.parse({
    body: raw,
    traceparent,
    path: hopPathOf(req.headers.get(HOP_PATH_HEADER)),
    deadline: hopDeadlineOf(req.headers.get(HOP_DEADLINE_HEADER)),
  });
  return gate.origin === "buckle"
    ? await serveHop(ctx, ride, sealed, { peerLabel: gate.originLabel, model })
    : gate.providerRow !== undefined && gate.providerRow.user_token
      ? await serveUser(ctx, ride, model, sealed, {
          label: gate.originLabel,
          url: gate.providerRow.url,
        })
      : await serveEngine(ctx, ride, model, sealed);
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

/** the BYOC leg: a user_token provider → the provider DIRECT, with
 *  the caller's own credential (relayed verbatim, then dropped). No
 *  fleet tags (no engine sits on this leg to read them); the settled
 *  event carries the provider label as the chain name. */
async function serveUser(
  ctx: ForwardCtx,
  ride: HopRide,
  model: string,
  stamp: LegStamp,
  target: { label: string; url: string },
): Promise<Response> {
  if (ctx.userToken === null)
    return problemResponse("unauthenticated", "the BYOC leg requires the user token");
  const openedAt = Date.now();
  emitOpened(ctx, model, openedAt);
  const outcome = await userChat({
    settings: ctx.settings,
    label: target.label,
    url: target.url,
    raw: ride.body,
    traceparent: ride.traceparent,
    route: stamp.route,
    token: ctx.userToken,
  });
  if (outcome.kind === "served")
    return settleServed(ctx, {
      model,
      leg: "user",
      openedAt,
      peer: target.label,
      injectedRule: stamp.injectedRule,
      laneSlug: stamp.laneSlug,
      outcome,
    });
  settleFailed(ctx, {
    model,
    leg: "user",
    openedAt,
    peer: target.label,
    fault: outcome.fault.kind,
  });
  return problemResponse(
    "unavailable",
    `provider ${target.label} ${outcome.fault.kind}`,
    `user leg fault: ${outcome.fault.kind}`,
  );
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
