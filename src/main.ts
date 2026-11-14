// main.ts — the serving shell: one Bun.serve, the route table, the
// per-request scaffold (trace, auth guard, admission, span export).
// No business logic lives here — every face delegates to its
// capability (access, admission, catalog, live, proxy); the shell
// only composes. Port comes from settings (one home, zod-defaulted).
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
import { createLive } from "./live/buckle.live.tracker.ts";
import { federatedStats } from "./live/buckle.live.stats.ts";
import { authenticate, bearerOf, holdsScope } from "./access/buckle.access.registry.ts";
import { createLimiter, resolveRpmCap } from "./admission/buckle.admission.limits.ts";
import { buildFederatedCatalog } from "./catalog/buckle.catalog.view.ts";
import { buildTree } from "./catalog/buckle.catalog.topology.ts";
import { forwardChat, problemResponse } from "./proxy/buckle.proxy.pipeline.ts";

export function bootServer(input: { settings: BuckleSettings; port?: number }) {
  const { settings } = input;
  const metrics = createMetrics(settings.hub.label);
  const live = createLive(settings.hub.label);
  const limiter = createLimiter();
  // THE token reader (secrets are paths, never values) — one
  // implementation, in the settings home; faults logged there
  const tokenOf = readToken;
  const server = Bun.serve({
    hostname: "0.0.0.0",
    port: input.port ?? settings.hub.ports.buckle,
    fetch: async (req) => {
      const startedAt = Date.now();
      const tp = continueTraceparent(req.headers.get("traceparent"));
      const done = (res: Response): Response => {
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
      };
      const { pathname } = new URL(req.url);
      const principal = authenticate(settings, bearerOf(req));
      const guard = (scope: BuckleScope): Response | null => {
        if (principal === null)
          return problemResponse("unauthenticated", "a principal key is required");
        if (!holdsScope(settings, principal, scope))
          return problemResponse(
            "forbidden",
            `${principal} lacks ${scope} on this buckle`,
          );
        return null;
      };
      if (pathname === "/v1/chat/completions" && req.method === "POST") {
        const denied = guard("models.use");
        if (denied !== null) return done(denied);
        if (principal !== null) {
          const grant = (settings.access?.grants ?? []).find(
            (g) => g.principal === principal,
          );
          const kind = settings.access?.principals.find(
            (p) => p.id === principal,
          )?.kind;
          const cap = resolveRpmCap(grant, kind, settings.access?.tiers ?? []);
          const verdict = limiter.admit(principal, cap);
          if (!verdict.allowed)
            return done(
              problemResponse(
                "rate-limited",
                "rpm cap reached",
                `${cap}/min on this buckle`,
                { "retry-after": String(verdict.retryAfterS) },
              ),
            );
          return done(
            await forwardChat(settings, metrics, live, principal, req, tp, tokenOf),
          );
        }
      }
      if (pathname === "/metrics")
        return done(
          new Response(metrics.render(), {
            headers: { "content-type": "text/plain; version=0.0.4" },
          }),
        );
      if (pathname === "/v1/models") {
        const denied = guard("models.list");
        if (denied !== null) return done(denied);
        if (principal !== null)
          return done(
            Response.json(
              await buildFederatedCatalog(settings, principal, tokenOf, tp),
              { headers: { "cache-control": "no-store" } },
            ),
          );
      }
      if (pathname === "/v1/stats") {
        const denied = guard("stats.read");
        if (denied !== null) return done(denied);
        return done(
          Response.json(await federatedStats(settings, live, tokenOf), {
            headers: { "cache-control": "no-store" },
          }),
        );
      }
      if (pathname === "/v1/tree") {
        const denied = guard("tree.read");
        if (denied !== null) return done(denied);
        return done(
          Response.json(await buildTree(settings, live, tokenOf, tp), {
            headers: { "cache-control": "no-store" },
          }),
        );
      }
      if (pathname === "/healthz")
        return done(
          Response.json(
            BuckleHealthz.parse({
              ok: true,
              status: "up",
              label: settings.hub.label,
              ...(settings.hub.version !== undefined
                ? { version: settings.hub.version }
                : {}),
              trace_id: traceIdOf(tp),
            }),
            { headers: { "cache-control": "no-store" } },
          ),
        );
      return done(new Response("not found", { status: 404 }));
    },
  });
  return server;
}

export async function main(paths: SettingsPaths & { port?: number }) {
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
