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
import { lanePrefixOf, userIdOf } from "./lane.ts";
import { pick } from "./pick.ts";
import {
  AdminKeyMintRequest,
  AdminHubEditRequest,
  adminState,
  applyHubEdit,
  mintPrincipalKey,
} from "./admin/buckle.admin.control.ts";

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
  /** the load paths — hub edits reload through them (null = the
   *  caller booted without paths: /admin/hubs refuses, no-over) */
  paths: SettingsPaths | null;
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
    /** the /w/<lane>/<token> BYOC credential when the URL carried one
     *  (a SECRET — never logged, never echoed; rides the user leg) */
    userToken: string | null;
    /** the bare (lane-stripped) path */
    path: string;
    /** the raw query string (`?…`, or "" — pass-through relays it) */
    search: string;
    /** the wire dialect for the handled LLM faces */
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

/** the BYOC identity derivation: a caller whose ONLY credential is
 *  the /w/ token (no principal key) rides the pseudonymous principal
 *  the lane contract derives — the ONE derivation, shared by every
 *  face that admits token riders (chat + models). */
function byocPrincipalOf(rq: {
  principal: string | null;
  userToken: string | null;
}): string | null {
  return rq.principal ?? (rq.userToken !== null ? userIdOf(rq.userToken) : null);
}

const chatFace: Face = async (srv, rq) => {
  // the BYOC identity: a token-only caller rides the pseudonymous
  // principal — the pipeline's BYOC gate (3.5) admits them to
  // user_token providers and REFUSES them everywhere else, so no
  // scope check fires here for them (a token is not a principal key)
  const principal = byocPrincipalOf(rq);
  if (principal === null)
    return problemResponse("unauthenticated", "a principal key is required");
  if (rq.principal !== null) {
    const denied = requireScope(srv, rq.principal, "models.use");
    if (denied !== null) return denied;
    const refused = admitPrincipal(srv, rq.principal);
    if (refused !== null) return refused;
  }
  return forwardChat(
    createForwardCtx({
      settings: srv.settings,
      bus: srv.bus,
      judge: srv.judge,
      principal,
      tokenOf: srv.tokenOf,
      userToken: rq.userToken,
    }),
    rq.req,
    rq.tp,
    { route: rq.route, laneSlug: rq.laneSlug },
  );
};

const modelsFace: Face = async (srv, rq) => {
  // BYOC callers (token, no key) may list too — their catalog pull
  // rides their own credential for user_token seats
  const principal = byocPrincipalOf(rq);
  if (principal === null)
    return problemResponse("unauthenticated", "a principal key is required");
  if (rq.principal !== null) {
    const denied = requireScope(srv, rq.principal, "models.list");
    if (denied !== null) return denied;
  }
  return Response.json(
    await buildFederatedCatalog({
      settings: srv.settings,
      principal,
      tokenOf: srv.tokenOf,
      traceparent: rq.tp,
      userToken: rq.userToken,
    }),
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

/** the admin seam — the GUI's control faces. Every one demands a
 *  keyed principal holding `admin`; the roster + scopes live in
 *  settings (code), the keys are minted secrets (0600 files). */
const adminGuard = (srv: ServerState, principal: string | null): Response | null =>
  requireScope(srv, principal, "admin");

const adminStateFace: Face = async (srv, rq) => {
  const denied = adminGuard(srv, rq.principal);
  if (denied !== null) return denied;
  return Response.json(adminState(srv.settings), { headers: noStore });
};

const adminKeysFace: Face = async (srv, rq) => {
  const denied = adminGuard(srv, rq.principal);
  if (denied !== null) return denied;
  const body = AdminKeyMintRequest.safeParse(await rq.req.json().catch(() => null));
  if (!body.success)
    return problemResponse("validation", 'body must be {"principal": "…"}', body.error.message);
  const out = mintPrincipalKey(srv.settings, body.data);
  if (out.kind === "minted")
    return Response.json({ principal: out.principal, key: out.key }, { status: 201, headers: noStore });
  if (out.kind === "already-keyed")
    return problemResponse("conflict", `${out.principal} already holds a key — revoke it first`, out.file);
  if (out.kind === "unknown-principal")
    return problemResponse("not-found", `${out.principal} is not declared in settings access.principals`);
  return problemResponse("validation", "keys.principals_dir is not configured");
};

const adminHubsFace: Face = async (srv, rq) => {
  const denied = adminGuard(srv, rq.principal);
  if (denied !== null) return denied;
  const body = AdminHubEditRequest.safeParse(await rq.req.json().catch(() => null));
  if (!body.success)
    return problemResponse("validation", "body must be {providers?|hubs?|lanes?} rows", body.error.message);
  const out = await applyHubEdit(srv.paths, srv.settings, body.data);
  if (out.kind === "applied") {
    srv.settings = out.settings; // the LIVE swap — no restart
    return Response.json(
      { ok: true, over: out.over, hub: adminState(out.settings) },
      { headers: noStore },
    );
  }
  if (out.kind === "no-over")
    return problemResponse("conflict", "this buckle has no over layer to write", out.detail);
  return problemResponse("validation", "the edit does not parse through the settings schema", out.detail);
};

/** THE route table — one row per face; anything NOT here rides the
 *  VERBATIM pass-through leg to the engine (the catch-all: every
 *  litellm face stays reachable through buckle exactly as litellm
 *  serves it — count_tokens, guardrails, the UI…) */
const routes: Record<string, Face> = {
  "POST /v1/chat/completions": chatFace,
  "POST /v1/messages": chatFace,
  "POST /v1/responses": chatFace,
  "GET /v1/models": modelsFace,
  "GET /v1/stats": statsFace,
  "GET /v1/tree": treeFace,
  "GET /healthz": healthzFace,
  "GET /metrics": metricsFace,
  "GET /admin/state": adminStateFace,
  "POST /admin/keys": adminKeysFace,
  "POST /admin/hubs": adminHubsFace,
};

const passThroughFace: Face = async (srv, rq) => {
  // the catch-all is ENGINE territory, reached verbatim — every litellm
  // admin face (keys, spend, config) sits behind it. It demands a
  // principal key AND an explicit engine.passthrough grant: never
  // anonymous, never on a models.use grant alone.
  if (rq.principal === null)
    return problemResponse("unauthenticated", "a principal key is required");
  const denied = requireScope(srv, rq.principal, "engine.passthrough");
  if (denied !== null) return denied;
  const refused = admitPrincipal(srv, rq.principal);
  if (refused !== null) return refused;
  return passThrough(srv.settings, rq.req, `${rq.path}${rq.search}`, srv.tokenOf);
};

/** the wire dialect by bare path — chat is the default face */
const ROUTE_BY_PATH: Record<string, ChatRoute> = {
  "/v1/messages": "messages",
  "/v1/responses": "responses",
};

export function bootServer(input: {
  settings: BuckleSettings;
  port?: number;
  /** the load paths — hub edits reload through them */
  paths?: SettingsPaths;
}) {
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
    paths: input.paths ?? null,
  });
  const { settings } = srv;
  return Bun.serve({
    hostname: "0.0.0.0",
    port: input.port ?? settings.hub.ports.buckle,
    // streaming generations go quiet for minutes (thinking-heavy
    // seats); Bun's 10s idle default cuts them mid-tool-call
    idleTimeout: settings.timeouts.server_idle_s,
    fetch: (req) => serveRequest(srv, req),
  });
}

/** the one dispatch: lane-prefix strip → face (or the verbatim
 *  pass-through) → span export. Extracted from bootServer so the
 *  boot path reads as composition, not control flow. */
async function serveRequest(srv: ServerState, req: Request): Promise<Response> {
  const { settings } = srv;
  const startedAt = Date.now();
  const tp = continueTraceparent(req.headers.get("traceparent"));
  // the /w/<slug> LANE PREFIX: attribution + launch pin from the
  // URL itself — stripped BEFORE dispatch (faces and the engine
  // both see the bare path; the slug rides as a fact + echo)
  const url = new URL(req.url);
  const { lane: laneSlug, path, userToken } = lanePrefixOf(url.pathname);
  const face = routes[`${req.method} ${path}`] ?? passThroughFace;
  const res = await face(srv, {
    req,
    tp,
    principal: authenticate(srv.settings, bearerOf(req)),
    userToken,
    path,
    search: url.search,
    route: ROUTE_BY_PATH[path] ?? "chat",
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
        "buckle.label": srv.settings.hub.label,
        ...pick("buckle.lane", laneSlug === "" ? undefined : laneSlug),
      },
    },
    settings,
  );
  return res;
}

async function main(paths: SettingsPaths & { port?: number }) {
  const settings = await loadSettings(paths);
  const port = paths.port ?? settings.hub.ports.buckle;
  bootServer({ settings, port, paths });
  console.log(`fleet-buckle ${settings.hub.label} on :${port} (trace id ${newTraceId()})`);
}

if (import.meta.main) {
  const paths = resolveSettingsPaths(process.argv.slice(2));
  await main(paths);
}
