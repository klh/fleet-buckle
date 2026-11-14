// main.ts — the serving shell: one Bun.serve, the route table, the
// per-request scaffold (trace, span export, auth). No business logic
// lives here — every face delegates to its capability (access,
// admission, catalog, live, proxy); the shell only composes. The
// route table is a MAP keyed "METHOD path" — adding a face adds a
// row, never another nested if. Port comes from settings (one home,
// zod-defaulted).
import type { BuckleSettings } from "./schemas/buckle.settings.zod.ts";
import { BuckleHealthz } from "./schemas/buckle.healthz.zod.ts";
import type { BuckleScope } from "./schemas/buckle.access.zod.ts";
import {
  continueTraceparent,
  exportSpan,
  newTraceId,
  traceIdOf,
} from "./live/buckle.live.trace.ts";
import { loadSettings, readToken, resolveSettingsPaths, type SettingsPaths } from "./settings.ts";
import { createMetrics } from "./live/buckle.live.metrics.ts";
import { createLive, type LiveTracker } from "./live/buckle.live.tracker.ts";
import { createStatsCache, statsBody } from "./live/buckle.live.stats.ts";
import { authenticate, bearerOf, holdsScope } from "./access/buckle.access.registry.ts";
import { createLimiter, resolveRpmCap } from "./admission/buckle.admission.limits.ts";
import { buildFederatedCatalog } from "./catalog/buckle.catalog.view.ts";
import { buildTree } from "./catalog/buckle.catalog.topology.ts";
import { createForwardCtx, forwardChat, problemResponse } from "./proxy/buckle.proxy.pipeline.ts";
import { pick } from "./pick.ts";

/** the server-scoped state every face shares — composed once at boot.
 *  Factory-typed (the live-values idiom: ReturnType of the one
 *  constructor). */
function createServerState(parts: {
  settings: BuckleSettings;
  metrics: ReturnType<typeof createMetrics>;
  live: LiveTracker;
  limiter: ReturnType<typeof createLimiter>;
  tokenOf: typeof readToken;
  stats: ReturnType<typeof createStatsCache>;
}) {
  return parts;
}
type ServerState = ReturnType<typeof createServerState>;

/** the per-request bundle — the face's whole input beyond the server
 *  state: the raw request, the continued trace, the authenticated
 *  principal (null = anonymous). */
type Face = (srv: ServerState, rq: { req: Request; tp: string; principal: string | null }) => Promise<Response>;

/** the scope guard: null = admitted, else the refusal response */
function requireScope(
  srv: ServerState,
  principal: string | null,
  scope: BuckleScope,
): Response | null {
  if (principal === null)
    return problemResponse("unauthenticated", "a principal key is required");
  if (!holdsScope(srv.settings, principal, scope))
    return problemResponse(
      "forbidden",
      `${principal} lacks ${scope} on this buckle`,
    );
  return null;
}

/** the admission check for the chat face: null = admitted, else the
 *  rpm refusal (Retry-After rides the client verdict) */
function admitPrincipal(
  srv: ServerState,
  principal: string | null,
): Response | null {
  if (principal === null) return null; // already refused by the guard
  const grant = (srv.settings.access?.grants ?? []).find(
    (g) => g.principal === principal,
  );
  const kind = srv.settings.access?.principals.find(
    (p) => p.id === principal,
  )?.kind;
  const cap = resolveRpmCap(grant, kind, srv.settings.access?.tiers ?? []);
  const verdict = srv.limiter.admit(principal, cap);
  return verdict.allowed
    ? null
    : problemResponse(
        "rate-limited",
        "rpm cap reached",
        `${cap}/min on this buckle`,
        { "retry-after": String(verdict.retryAfterS) },
      );
}

const noStore = { "cache-control": "no-store" };

const chatFace: Face = async (srv, rq) => {
  const denied = requireScope(srv, rq.principal, "models.use");
  if (denied !== null) return denied;
  const refused = admitPrincipal(srv, rq.principal);
  if (refused !== null) return refused;
  return forwardChat(
    createForwardCtx({
      settings: srv.settings,
      metrics: srv.metrics,
      live: srv.live,
      principal: rq.principal as string,
      tokenOf: srv.tokenOf,
    }),
    rq.req,
    rq.tp,
  );
};

const modelsFace: Face = async (srv, rq) => {
  const denied = requireScope(srv, rq.principal, "models.list");
  if (denied !== null) return denied;
  return Response.json(
    await buildFederatedCatalog(
      srv.settings,
      rq.principal as string,
      srv.tokenOf,
      rq.tp,
    ),
    { headers: noStore },
  );
};

const statsFace: Face = async (srv, rq) => {
  const denied = requireScope(srv, rq.principal, "stats.read");
  if (denied !== null) return denied;
  return Response.json(
    await statsBody(srv.settings, srv.live, srv.stats),
    { headers: noStore },
  );
};

const treeFace: Face = async (srv, rq) => {
  const denied = requireScope(srv, rq.principal, "tree.read");
  if (denied !== null) return denied;
  return Response.json(
    await buildTree(srv.settings, srv.live, srv.tokenOf, rq.tp),
    { headers: noStore },
  );
};

const healthzFace: Face = async (srv, rq) =>
  Response.json(
    BuckleHealthz.parse({
      ok: true,
      status: "up",
      label: srv.settings.hub.label,
      ...pick("version", srv.settings.hub.version),
      trace_id: traceIdOf(rq.tp),
    }),
    { headers: noStore },
  );

const metricsFace: Face = async (srv) =>
  new Response(srv.metrics.render(), {
    headers: { "content-type": "text/plain; version=0.0.4" },
  });

/** THE route table — one row per face; the 404 is the fallback */
const routes: Record<string, Face> = {
  "POST /v1/chat/completions": chatFace,
  "GET /v1/models": modelsFace,
  "GET /v1/stats": statsFace,
  "GET /v1/tree": treeFace,
  "GET /healthz": healthzFace,
  "GET /metrics": metricsFace,
};

const notFoundFace: Face = async () => new Response("not found", { status: 404 });

export function bootServer(input: { settings: BuckleSettings; port?: number }) {
  const srv = createServerState({
    settings: input.settings,
    metrics: createMetrics(input.settings.hub.label),
    live: createLive(input.settings.hub.label),
    limiter: createLimiter(),
    // THE token reader (secrets are paths, never values) — one
    // implementation, in the settings home; faults logged there
    tokenOf: readToken,
    stats: createStatsCache(input.settings, readToken),
  });
  const { settings } = srv;
  return Bun.serve({
    hostname: "0.0.0.0",
    port: input.port ?? settings.hub.ports.buckle,
    fetch: async (req) => {
      const startedAt = Date.now();
      const tp = continueTraceparent(req.headers.get("traceparent"));
      const face =
        routes[`${req.method} ${new URL(req.url).pathname}`] ?? notFoundFace;
      const res = await face(srv, {
        req,
        tp,
        principal: authenticate(settings, bearerOf(req)),
      });
      exportSpan(
        {
          name: `${req.method} ${new URL(req.url).pathname}`,
          traceparent: tp,
          startedAt,
          endedAt: Date.now(),
          attributes: {
            "http.status": res.status,
            "buckle.label": settings.hub.label,
          },
        },
        settings,
      );
      return res;
    },
  });
}

async function main(paths: SettingsPaths & { port?: number }) {
  const settings = await loadSettings(paths);
  const port = paths.port ?? settings.hub.ports.buckle;
  bootServer({ settings, port });
  console.log(
    `fleet-buckle ${settings.hub.label} on :${port} (trace id ${newTraceId()})`,
  );
}

if (import.meta.main) {
  const paths = resolveSettingsPaths(process.argv.slice(2));
  await main(paths);
}
