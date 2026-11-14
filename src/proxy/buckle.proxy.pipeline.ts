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
import type { BucklePrincipalKind } from "../schemas/buckle.principal.zod.ts";
import { peerToken, type TokenReader } from "../federation/buckle.federation.peer.ts";
import {
  HOP_DEADLINE_HEADER,
  HOP_PATH_HEADER,
  SERVED_BY_HEADER,
  HopPeerSchema,
  hopDeadlineOf,
  hopPathOf,
  wouldLoop,
} from "../federation/buckle.federation.protocol.ts";
import { buildFederatedCatalog } from "../catalog/buckle.catalog.view.ts";
import { hopChat } from "./buckle.proxy.hop.ts";
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

/** the principal's kind from the registry (absent registry row =
 *  undefined — the tracker renders the row without a kind) */
function kindOf(settings: BuckleSettings, principal: string): BucklePrincipalKind | undefined {
  return settings.access?.principals.find((p) => p.id === principal)?.kind;
}

/** settle a SERVED outcome (the shared surface): count the request,
 *  bank the usage tokens, raw bytes back out with the chain named */
function settleServed(
  metrics: MetricsRegistry,
  live: LiveTracker,
  principal: string,
  model: string,
  outcome: ServedOutcome,
): Response {
  metrics.countRequest(model);
  live.close(principal, model, usageOf(outcome.text));
  return servedResponse(outcome);
}

/** settle a FAILED outcome (the shared half): the tracker closes at
 *  zero, the request still counts — leg-specific verdicts answer
 *  after this, locally narrowed */
function settleFailed(
  metrics: MetricsRegistry,
  live: LiveTracker,
  principal: string,
  model: string,
): void {
  live.close(principal, model, 0);
  metrics.countRequest(model);
}

export async function forwardChat(
  settings: BuckleSettings,
  metrics: MetricsRegistry,
  live: LiveTracker,
  principal: string,
  req: Request,
  traceparent: string,
  tokenOf: TokenReader,
): Promise<Response> {
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

  // 5 — the leg: buckle-origin hops, provider-origin rides our engine
  return known.origin.kind === "buckle"
    ? await serveHop(settings, metrics, live, principal, known.origin.label, raw, traceparent, inboundPath, deadline, tokenOf, model)
    : await serveEngine(settings, metrics, live, principal, raw, traceparent, model, tokenOf);
}

/** the peer leg: buckle-origin model → that peer, verbatim */
async function serveHop(
  settings: BuckleSettings,
  metrics: MetricsRegistry,
  live: LiveTracker,
  principal: string,
  peerLabel: string,
  raw: string,
  traceparent: string,
  inboundPath: string[],
  deadline: number | null,
  tokenOf: TokenReader,
  model: string,
): Promise<Response> {
  const peer = settings.hubs?.[peerLabel];
  if (peer === undefined)
    return problemResponse(
      "unavailable",
      `peer ${peerLabel} is no longer configured`,
    );
  const token = peerToken(peer, tokenOf);
  const hopPeer = HopPeerSchema.safeParse({
    label: peerLabel,
    url: peer.url,
    token,
  });
  if (!hopPeer.success)
    return problemResponse(
      "unavailable",
      `peer ${peerLabel} is misconfigured`,
      hopPeer.error.issues.map((i) => i.path.join(".")).join(", "),
    );

  live.open(principal, kindOf(settings, principal), model);
  const outcome = await hopChat(
    settings.hub.label,
    hopPeer.data,
    raw,
    traceparent,
    inboundPath,
    deadline,
    settings.timeouts.hop_ms,
  );
  if (outcome.kind === "served") return settleServed(metrics, live, principal, model, outcome);
  settleFailed(metrics, live, principal, model);
  if (outcome.kind === "rate-limited")
    // the peer's verdict RELAYS: the client must see Retry-After
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

/** the engine leg: provider-origin model → OUR litellm */
async function serveEngine(
  settings: BuckleSettings,
  metrics: MetricsRegistry,
  live: LiveTracker,
  principal: string,
  raw: string,
  traceparent: string,
  model: string,
  tokenOf: TokenReader,
): Promise<Response> {
  live.open(principal, kindOf(settings, principal), model);
  const outcome = await engineChat(settings, raw, traceparent, tokenOf);
  if (outcome.kind === "served") return settleServed(metrics, live, principal, model, outcome);
  settleFailed(metrics, live, principal, model);
  // outcome.kind === "fault" — named, already logged at the seam
  return problemResponse(
    "unavailable",
    `engine ${outcome.fault.kind}`,
    `engine leg fault: ${outcome.fault.kind}`,
  );
}
