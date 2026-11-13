// buckle.server.forward.ts — the MITM loop. The model resolves in the
// PRINCIPAL'S federated view (own rows + peers their grant admits):
// a provider-origin model forwards to OUR engine; a buckle-origin
// model HOPS to that peer verbatim (the peer re-checks models.use
// against its own registry — per-hop grants). Drift fails loud
// (problem+json 404). Bodies ride UNTOUCHED (raw bytes in, raw bytes
// out); the trace CONTINUES; the serving chain rides x-fleet-buckle-served-by;
// every hop counts in /metrics.
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import {
  buildFederatedCatalog,
  type TokenReader,
} from "./buckle.server.models.ts";
import type { MetricsRegistry } from "./buckle.server.metrics.ts";
import type { LiveTracker } from "./buckle.server.live.ts";
import { continueTraceparent } from "./buckle.server.telemetry.ts";
import {
  HOP_PATH_HEADER,
  SERVED_BY_HEADER,
  HopPeerSchema,
  hopChat,
  hopPathOf,
  wouldLoop,
} from "./buckle.server.hop.ts";
import { problemResponse } from "./buckle.server.problem.ts";

export { problemResponse };

/** bounded waits: a hung engine must not hold the client forever */
const ENGINE_TIMEOUT_MS = 120_000;

export function engineUrl(settings: BuckleSettings): string {
  return (
    settings.engine?.url ??
    process.env["BUCKLE_ENGINE_URL"] ??
    "http://127.0.0.1:4000"
  );
}

/** total_tokens out of an upstream chat body (0 when absent/unparseable) */
function usageTokensOf(text: string): number {
  try {
    const usage = (JSON.parse(text) as { usage?: { total_tokens?: unknown } })
      .usage;
    if (usage !== undefined && typeof usage.total_tokens === "number")
      return usage.total_tokens;
  } catch {
    // non-JSON engine body: no token count, still a passthrough
  }
  return 0;
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
  const raw = await req.text();
  let model: string | null = null;
  try {
    const body = JSON.parse(raw) as { model?: unknown };
    if (typeof body.model === "string") model = body.model;
  } catch {
    // fall through: missing model fails loud below
  }
  if (model === null)
    return problemResponse("validation", "chat body missing model");

  // the loop guard fires BEFORE any peer traffic: a hub already on the
  // hop path refuses re-entry, no matter the model
  const inboundPath = hopPathOf(req.headers.get(HOP_PATH_HEADER));
  if (wouldLoop(inboundPath, settings.hub.label))
    return problemResponse(
      "unavailable",
      "federation loop refused",
      `${settings.hub.label} is already on ${HOP_PATH_HEADER}: ${inboundPath.join(",")}`,
    );

  // resolve in the principal's FEDERATED view — a peer model a grant
  // does not admit is indistinguishable from an unknown model (no leak)
  const catalog = await buildFederatedCatalog(settings, principal, tokenOf, traceparent);
  const known = catalog.models.find((m) => m.id === model);
  if (known === undefined)
    return problemResponse(
      "not-found",
      `model ${model} is not served by this buckle`,
    );

  const kind = settings.access?.principals.find((p) => p.id === principal)?.kind;

  // the peer hop: buckle-origin model → that peer, verbatim
  if (known.origin.kind === "buckle") {
    const peer = settings.hubs?.[known.origin.label];
    if (peer === undefined)
      return problemResponse(
        "unavailable",
        `peer ${known.origin.label} is no longer configured`,
      );
    const token = peer.token_file !== undefined ? tokenOf(peer.token_file) : null;
    const hopPeer = HopPeerSchema.safeParse({
      label: known.origin.label,
      url: peer.url,
      token,
    });
    if (!hopPeer.success)
      return problemResponse(
        "unavailable",
        `peer ${known.origin.label} is misconfigured`,
        hopPeer.error.issues.map((i) => i.path.join(".")).join(", "),
      );
    live.open(principal, kind, model);
    const outcome = await hopChat(
      settings.hub.label,
      hopPeer.data,
      raw,
      traceparent,
      inboundPath,
    );
    if (outcome.kind === "served") {
      metrics.countRequest(model);
      live.close(principal, model, usageTokensOf(outcome.text));
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
    if (outcome.kind === "rate-limited") {
      // the peer's verdict RELAYS: the client must see Retry-After
      metrics.countRequest(model);
      return problemResponse(
        "rate-limited",
        `peer ${known.origin.label} rate-limited the hop`,
        outcome.detail,
        { "retry-after": String(outcome.retryAfterS) },
      );
    }
    if (outcome.kind === "refused") {
      metrics.countRequest(model);
      return problemResponse(
        "unavailable",
        `peer ${known.origin.label} refused the hop`,
        outcome.detail,
      );
    }
    return problemResponse(
      "unavailable",
      `peer ${known.origin.label} unreachable`,
      outcome.detail,
    );
  }

  // the engine path: provider-origin model → OUR litellm
  const engine = `${engineUrl(settings).replace(/\/$/, "")}/v1/chat/completions`;
  live.open(principal, kind, model);
  try {
    const upstream = await fetch(engine, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        traceparent: continueTraceparent(traceparent),
      },
      body: raw,
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
    });
    metrics.countRequest(model);
    const text = await upstream.text();
    live.close(principal, model, usageTokensOf(text));
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
        [SERVED_BY_HEADER]: settings.hub.label,
      },
    });
  } catch (e) {
    live.close(principal, model, 0);
    if (
      e instanceof Error &&
      (e.name === "AbortError" || e.name === "TimeoutError")
    )
      return problemResponse("unavailable", "engine timeout");
    return problemResponse("unavailable", "engine unreachable");
  }
}
