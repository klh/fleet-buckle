// proxy/buckle.proxy.passthrough.ts — the VERBATIM relay: any request
// buckle does not itself handle rides STRAIGHT to the engine,
// byte-identical (method, path, query, headers, body stream). The
// buckle owns three jobs — multihop, the access proxy, context
// injection — every other litellm face (models admin, count_tokens,
// /v1/responses, guardrails, spend, health…) stays reachable
// THROUGH the buckle exactly as litellm serves it. Streaming both
// ways (never buffered); hop-internal headers never ride; the
// engine's own authz sees the engine token, the caller's buckle key
// is consumed at the gate.
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { httpSend } from "../fault.ts";
import type { TokenReader } from "../federation/buckle.federation.peer.ts";
import { problemResponse } from "../problem.ts";

/** request headers the relay NEVER forwards: hop-internal state,
 *  per-hop transport framing, and the caller's own credential (the
 *  engine token replaces it) */
const DROP_REQUEST_HEADERS = new Set([
  "authorization",
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

/** response headers the relay NEVER forwards back: framing the
 *  client transport recomputes (the body streams through decoded) */
const DROP_RESPONSE_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

function relayHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    if (!DROP_REQUEST_HEADERS.has(key)) out[key] = value;
  });
  return out;
}

/** relay one request verbatim to the engine — the pass-through leg.
 *  No body read, no event, no injection: the bytes are not ours. */
export async function passThrough(
  settings: BuckleSettings,
  req: Request,
  pathnameWithQuery: string,
  tokenOf: TokenReader,
): Promise<Response> {
  if (settings.engine === undefined)
    return problemResponse(
      "unavailable",
      "pass-through refused",
      "no engine configured on this unit",
    );
  const target = `${settings.engine.url.replace(/\/$/, "")}${pathnameWithQuery}`;
  const engineToken = settings.keys?.engine !== undefined ? tokenOf(settings.keys.engine) : null;
  const sent = await httpSend(
    target,
    {
      method: req.method,
      headers: {
        ...relayHeaders(req),
        ...(engineToken !== null ? { authorization: `Bearer ${engineToken}` } : {}),
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      // streaming request body (duplex half — the bytes ride, never buffered)
      duplex: "half",
      redirect: "manual",
    },
    settings.timeouts.engine_ms,
  );
  if (!sent.ok)
    return problemResponse(
      "unavailable",
      "engine pass-through fault",
      `leg fault: ${sent.fault.kind}`,
    );
  const headers = new Headers();
  sent.response.headers.forEach((value, key) => {
    if (!DROP_RESPONSE_HEADERS.has(key)) headers.set(key, value);
  });
  // the engine's answer streams back verbatim — status, headers, body
  return new Response(sent.response.body, {
    status: sent.response.status,
    headers,
  });
}
