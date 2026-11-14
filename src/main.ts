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
} from "./trace/buckle.trace.export.ts";
import { loadSettings, readToken, resolveSettingsPaths, type SettingsPaths } from "./settings.ts";
import {
  createMetrics,
  subscribeExposition,
  type MetricsRegistry,
} from "./metrics/buckle.metrics.exposition.ts";
import {
  createLive,
  subscribeTracker,
  type LiveTracker,
} from "./metrics/buckle.metrics.tracker.ts";
import { createStatsCache, statsBody } from "./metrics/buckle.metrics.stats.ts";
import {
  createEngineCollector,
  type EngineTelemetrySource,
} from "./metrics/buckle.metrics.engine.ts";
import { createEventBus } from "./events/buckle.events.bus.ts";
import { judgeFromSettings, type ContextJudge } from "./context/buckle.context.judge.ts";
import { authenticate, bearerOf, holdsScope } from "./access/buckle.access.registry.ts";
import { createLimiter, resolveRpmCap } from "./admission/buckle.admission.limits.ts";
import { buildFederatedCatalog } from "./catalog/buckle.catalog.view.ts";
import { buildTree } from "./catalog/buckle.catalog.topology.ts";
import { createForwardCtx } from "./proxy/buckle.proxy.ctx.ts";
import { forwardChat, problemResponse, type ChatRoute } from "./proxy/buckle.proxy.pipeline.ts";
import { passThrough } from "./proxy/buckle.proxy.passthrough.ts";
import { lanePrefixOf } from "./lane.ts";
import { pick } from "./pick.ts";

/** the server-scoped state every face shares — composed once at boot.
 *  Factory-typed (the live-values idiom: ReturnType of the one
 *  constructor). */
function createServerState(parts: {
  settings: BuckleSettings;
  bus: ReturnType<typeof createEventBus>;
  metrics: MetricsRegistry;
  live: LiveTracker;
  limiter: ReturnType<typeof createLimiter>;
  tokenOf: typeof readToken;
  stats: ReturnType<typeof createStatsCache>;
  engine: EngineTelemetrySource;
  judge: ContextJudge;
}) {
  return parts;
}
type ServerState = ReturnType<typeof createServerState>;

/** the per-request bundle — the face's whole input beyond the server
 *  state: the raw request, the continued trace, the authenticated
 *  principal (null = anonymous). */
type Face = (
  srv: ServerState,
  rq: {
    req: Request;
    tp: string;
    principal: string | null;
    /** the bare (lane-stripped) path */
    path: string;
    /** the raw query string (`?…`, or "" — pass-through relays it) */
    search: string;
    /** the chat dialect for the two handled LLM faces */
    route: ChatRoute;
    /** the /w/<slug> slug riding this request ("" on bare paths) */
    laneSlug: string;
  },
) => Promise<Response>;

/** the scope guard: null = admitted, else the refusal response */
function requireScope(
  srv: ServerState,
  principal: string | null,
  scope: BuckleScope,
): Response | null {
  if (principal === null) return problemResponse("unauthenticated", "a principal key is required");
  if (!holdsScope(srv.settings, principal, scope))
    return problemResponse("forbidden", `${principal} lacks ${scope} on this buckle`);
  return null;
}

/** the admission check for the chat face: null = admitted, else the
 *  rpm refusal (Retry-After rides the client verdict) */
function admitPrincipal(srv: ServerState, principal: string | null): Response | null {
  if (principal === null) return null; // already refused by the guard
  const grant = (srv.settings.access?.grants ?? []).find((g) => g.principal === principal);
  const kind = srv.settings.access?.principals.find((p) => p.id === principal)?.kind;
  const cap = resolveRpmCap(grant, kind, srv.settings.access?.tiers ?? []);
  const verdict = srv.limiter.admit(principal, cap);
  return verdict.allowed
    ? null
    : problemResponse("rate-limited", "rpm cap reached", `${cap}/min on this buckle`, {
        "retry-after": String(verdict.retryAfterS),
      });
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
      bus: srv.bus,
      judge: srv.judge,
      principal: rq.principal as string,
      tokenOf: srv.tokenOf,
    }),
    rq.req,
    rq.tp,
    { route: rq.route as ChatRoute, laneSlug: rq.laneSlug },
  );
};

const modelsFace: Face = async (srv, rq) => {
  const denied = requireScope(srv, rq.principal, "models.list");
  if (denied !== null) return denied;
  return Response.json(
    await buildFederatedCatalog(srv.settings, rq.principal as string, srv.tokenOf, rq.tp),
    { headers: noStore },
  );
};

const statsFace: Face = async (srv, rq) => {
  const denied = requireScope(srv, rq.principal, "stats.read");
  if (denied !== null) return denied;
  return Response.json(await statsBody(srv.settings, srv.live, srv.stats, srv.engine), {
    headers: noStore,
  });
};

const treeFace: Face = async (srv, rq) => {
  const denied = requireScope(srv, rq.principal, "tree.read");
  if (denied !== null) return denied;
  return Response.json(await buildTree(srv.settings, srv.live, srv.tokenOf, rq.tp), {
    headers: noStore,
  });
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

/** THE route table — one row per face; anything NOT here rides the
 *  VERBATIM pass-through leg to the engine (the catch-all: every
 *  litellm face stays reachable through buckle exactly as litellm
 *  serves it — /v1/responses, count_tokens, guardrails, the UI…) */
const routes: Record<string, Face> = {
  "POST /v1/chat/completions": chatFace,
  "POST /v1/messages": chatFace,
  "GET /v1/models": modelsFace,
  "GET /v1/stats": statsFace,
  "GET /v1/tree": treeFace,
  "GET /healthz": healthzFace,
  "GET /metrics": metricsFace,
};

const passThroughFace: Face = async (srv, rq) => {
  const refused = admitPrincipal(srv, rq.principal);
  if (refused !== null) return refused;
  return passThrough(srv.settings, rq.req, `${rq.path}${rq.search ?? ""}`, srv.tokenOf);
};

export function bootServer(input: { settings: BuckleSettings; port?: number }) {
  // the EVENT BUS: the pipeline's one write seam; collectors
  // subscribe here — the faces never know who is counting
  const bus = createEventBus();
  const metrics = createMetrics(input.settings.hub.label);
  const live = createLive(input.settings.hub.label);
  subscribeTracker(bus, live);
  subscribeExposition(bus, metrics);
  // the CONTEXT JUDGE: built ONCE (stanzas resolved at boot, fail
  // loud) — the chat face rides the decision, never the build
  const judge = judgeFromSettings(input.settings);
  const srv = createServerState({
    settings: input.settings,
    bus,
    metrics,
    live,
    limiter: createLimiter(),
    // THE token reader (secrets are paths, never values) — one
    // implementation, in the settings home; faults logged there
    tokenOf: readToken,
    stats: createStatsCache(input.settings, readToken),
    engine: createEngineCollector(input.settings, readToken),
    judge,
  });
  const { settings } = srv;
  return Bun.serve({
    hostname: "0.0.0.0",
    port: input.port ?? settings.hub.ports.buckle,
    fetch: async (req) => {
      const startedAt = Date.now();
      const tp = continueTraceparent(req.headers.get("traceparent"));
      // the /w/<slug> LANE PREFIX: attribution + launch pin from the
      // URL itself — stripped BEFORE dispatch (faces and the engine
      // both see the bare path; the slug rides as a fact + echo)
      const url = new URL(req.url);
      const { lane: laneSlug, path } = lanePrefixOf(url.pathname);
      const face = routes[`${req.method} ${path}`] ?? passThroughFace;
      const res = await face(srv, {
        req,
        tp,
        principal: authenticate(settings, bearerOf(req)),
        path,
        search: url.search,
        route: path === "/v1/messages" ? "messages" : "chat",
        laneSlug,
      });
      exportSpan(
        {
          name: `${req.method} ${path}`,
          traceparent: tp,
          startedAt,
          endedAt: Date.now(),
          attributes: {
            "http.status": res.status,
            "buckle.label": settings.hub.label,
            ...pick("buckle.lane", laneSlug === "" ? undefined : laneSlug),
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
  console.log(`fleet-buckle ${settings.hub.label} on :${port} (trace id ${newTraceId()})`);
}

if (import.meta.main) {
  const paths = resolveSettingsPaths(process.argv.slice(2));
  await main(paths);
}
