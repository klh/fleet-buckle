// buckle.server.forward.ts — the MITM loop. The model resolves in the
// PRINCIPAL'S federated view (own rows + peers their grant admits):
// a provider-origin model forwards to OUR engine; a buckle-origin
// model HOPS to that peer verbatim (the peer re-checks models.use
// against its own registry — per-hop grants). Drift fails loud
// (problem+json 404). Bodies ride UNTOUCHED (raw bytes in, raw bytes
// out); the trace CONTINUES; the serving chain rides x-fleet-buckle-served-by;
// every request counts in /metrics. This module is the PIPELINE —
// the two legs live in buckle.server.hop.ts and buckle.server.engine.ts.
import { z } from "zod";
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import {
  buildFederatedCatalog,
  type TokenReader,
} from "./buckle.server.federated.ts";
import type { MetricsRegistry } from "./buckle.server.metrics.ts";
import type { LiveTracker } from "./buckle.server.live.ts";
import {
  HOP_DEADLINE_HEADER,
  HOP_PATH_HEADER,
  SERVED_BY_HEADER,
  HopPeerSchema,
  hopChat,
  hopDeadlineOf,
  hopPathOf,
  wouldLoop,
} from "./buckle.server.hop.ts";
import { engineChat, usageOf } from "./buckle.server.engine.ts";
import { problemResponse } from "./buckle.server.problem.ts";

export { problemResponse };

/** we read ONLY the model id out of the chat body — everything else
 *  rides verbatim (the engine owns its own face, never re-schematized) */
const ChatBody = z.object({ model: z.string().min(1) }).passthrough();

function modelOf(raw: string): string | null {
  const parsed = ChatBody.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data.model : null;
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
  let model: string | null = null;
  try {
    model = modelOf(raw);
  } catch {
    // fall through: unparseable body fails loud below
  }
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
  const token = peer.token_file !== undefined ? tokenOf(peer.token_file) : null;
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

  const kind = settings.access?.principals.find((p) => p.id === principal)?.kind;
  live.open(principal, kind, model);
  const outcome = await hopChat(
    settings.hub.label,
    hopPeer.data,
    raw,
    traceparent,
    inboundPath,
    deadline,
  );
  if (outcome.kind === "served") {
    metrics.countRequest(model);
    live.close(principal, model, usageOf(outcome.text));
    return new Response(outcome.text, {
      status: outcome.status,
      headers: {
        "content-type": outcome.contentType,
        "cache-control": "no-store",
        [SERVED_BY_HEADER]: outcome.servedBy,
      },
    });
  }
  live.close(principal, model, 0);
  metrics.countRequest(model);
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
  return problemResponse(
    "unavailable",
    `peer ${peerLabel} unreachable`,
    outcome.detail,
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
  const kind = settings.access?.principals.find((p) => p.id === principal)?.kind;
  live.open(principal, kind, model);
  const outcome = await engineChat(settings, raw, traceparent, tokenOf);
  if (outcome.kind === "served") {
    metrics.countRequest(model);
    live.close(principal, model, usageOf(outcome.text));
    return new Response(outcome.text, {
      status: outcome.status,
      headers: {
        "content-type": outcome.contentType,
        "cache-control": "no-store",
        [SERVED_BY_HEADER]: settings.hub.label,
      },
    });
  }
  live.close(principal, model, 0);
  metrics.countRequest(model);
  return problemResponse(
    "unavailable",
    outcome.kind === "timeout" ? "engine timeout" : "engine unreachable",
  );
}
