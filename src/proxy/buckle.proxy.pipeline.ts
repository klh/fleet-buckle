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
import type { MetricsRegistry } from "../live/buckle.live.metrics.ts";
import type { LiveTracker } from "../live/buckle.live.tracker.ts";
import { parseJson } from "../fault.ts";
import { problemResponse } from "../problem.ts";

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
  metrics: MetricsRegistry;
  live: LiveTracker;
  principal: string;
  tokenOf: TokenReader;
}) {
  const kind = parts.settings.access?.principals.find(
    (p) => p.id === parts.principal,
  )?.kind;
  return { ...parts, kind } as const;
}
type ForwardCtx = ReturnType<typeof createForwardCtx>;

/** settle a SERVED outcome (the shared surface): count the request,
 *  bank the usage tokens, raw bytes back out with the chain named */
function settleServed(
  ctx: ForwardCtx,
  model: string,
  outcome: ServedOutcome,
): Response {
  ctx.metrics.countRequest(model);
  ctx.live.close(ctx.principal, model, usageOf(outcome.text));
  return servedResponse(outcome);
}

/** settle a FAILED outcome (the shared half): the tracker closes at
 *  zero, the request still counts — leg-specific verdicts answer
 *  after this, locally narrowed */
function settleFailed(ctx: ForwardCtx, model: string): void {
  ctx.live.close(ctx.principal, model, 0);
  ctx.metrics.countRequest(model);
}

export async function forwardChat(
  ctx: ForwardCtx,
  req: Request,
  traceparent: string,
): Promise<Response> {
  const { settings, principal, tokenOf } = ctx;
  // 1 — the body must name a model (drift fails loud); the raw bytes
  //     are read ONCE and ride untouched from here on
  const raw = await req.text();
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

  ctx.live.open(ctx.principal, ctx.kind, model);
  const outcome = await hopChat(
    settings.hub.label,
    hopPeer.data,
    ride,
    settings.timeouts.hop_ms,
  );
  if (outcome.kind === "served") return settleServed(ctx, model, outcome);
  settleFailed(ctx, model);
  return verdictOf(peerLabel, outcome);
}

/** the engine leg: provider-origin model → OUR litellm */
async function serveEngine(
  ctx: ForwardCtx,
  ride: HopRide,
  model: string,
): Promise<Response> {
  ctx.live.open(ctx.principal, ctx.kind, model);
  const outcome = await engineChat(ctx.settings, ride.body, ride.traceparent, ctx.tokenOf);
  if (outcome.kind === "served") return settleServed(ctx, model, outcome);
  settleFailed(ctx, model);
  // outcome.kind === "fault" — named, already logged at the seam
  return problemResponse(
    "unavailable",
    `engine ${outcome.fault.kind}`,
    `engine leg fault: ${outcome.fault.kind}`,
  );
}
