// buckle.server.forward.ts — the MITM loop: validate the model exists
// in OUR catalog (drift fails loud: problem+json 404), then forward to
// the engine with the W3C trace CONTINUED (same trace id, new span).
// The response passes through untouched; every hop counts in /metrics.
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import {
  BuckleProblem,
  BuckleProblemStatus,
  type BuckleProblemKind,
} from "../schemas/buckle.problem.zod.ts";
import { buildCatalog } from "./buckle.server.models.ts";
import type { MetricsRegistry } from "./buckle.server.metrics.ts";
import type { LiveTracker } from "./buckle.server.live.ts";
import { continueTraceparent } from "./buckle.server.telemetry.ts";

export function engineUrl(settings: BuckleSettings): string {
  return (
    settings.engine?.url ??
    process.env["BUCKLE_ENGINE_URL"] ??
    "http://127.0.0.1:4000"
  );
}

export function problemResponse(
  kind: BuckleProblemKind,
  title: string,
  detail?: string,
): Response {
  const problem = BuckleProblem.parse({
    type: "https://buckle.fleet/problems/1",
    kind,
    title,
    status: BuckleProblemStatus[kind],
    ...(detail === undefined ? {} : { detail }),
  });
  return Response.json(problem, {
    status: problem.status,
    headers: { "content-type": "application/problem+json" },
  });
}

export async function forwardChat(
  settings: BuckleSettings,
  metrics: MetricsRegistry,
  live: LiveTracker,
  principal: string,
  req: Request,
  traceparent: string,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as
    | { model?: unknown }
    | null;
  const model = typeof body?.model === "string" ? body.model : null;
  if (model === null)
    return problemResponse("validation", "chat body missing model");

  const catalog = await buildCatalog(settings, traceparent);
  const known = catalog.models.find((m) => m.id === model);
  if (known === undefined)
    return problemResponse(
      "not-found",
      `model ${model} is not served by this buckle`,
    );

  const engine = `${engineUrl(settings).replace(/\/$/, "")}/v1/chat/completions`;
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      traceparent: continueTraceparent(traceparent),
    },
    body: JSON.stringify(body),
  };
  const kind = settings.access?.principals.find((p) => p.id === principal)?.kind;
  live.open(principal, kind, model);
  try {
    const upstream = await fetch(engine, init);
    metrics.countRequest(model);
    // buffer to count usage tokens for the live overview (chat bodies
    // are small; the demo does not stream SSE)
    const text = await upstream.text();
    let tokens = 0;
    try {
      const usage = (JSON.parse(text) as { usage?: { total_tokens?: unknown } }).usage;
      if (usage !== undefined && typeof usage.total_tokens === "number")
        tokens = usage.total_tokens;
    } catch {
      // non-JSON engine body: no token count, still a passthrough
    }
    live.close(principal, model, tokens);
    return new Response(text, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    live.close(principal, model, 0);
    if (e instanceof Error && e.name === "AbortError")
      return problemResponse("unavailable", "engine timeout");
    return problemResponse("unavailable", "engine unreachable");
  }
}
