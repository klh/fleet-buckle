// buckle.server.main.ts — the wire server. Routes land step by step
// (test-first): STEP 1 /healthz; catalog + forward + /metrics follow in
// commits 3's later steps. Every answer carries a trace id; every
// request ends with an OTLP span export.
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { BuckleHealthz } from "../schemas/buckle.healthz.zod.ts";
import {
  continueTraceparent,
  exportSpan,
  newTraceId,
  traceIdOf,
} from "./buckle.server.telemetry.ts";
import { loadSettings, type SettingsPaths } from "./buckle.server.settings.ts";
import { buildCatalog } from "./buckle.server.models.ts";
import { forwardChat, problemResponse } from "./buckle.server.forward.ts";
import type { BuckleScope } from "../schemas/buckle.access.zod.ts";
import { createMetrics } from "./buckle.server.metrics.ts";
import { authenticate, bearerOf, holdsScope } from "./buckle.server.access.ts";
import { createLive, federatedStats } from "./buckle.server.live.ts";
import { buildTree } from "./buckle.server.tree.ts";
import { readFileSync } from "node:fs";

export function bootServer(input: { settings: BuckleSettings; port?: number }) {
  const { settings } = input;
  const metrics = createMetrics(settings.hub.label);
  const live = createLive(settings.hub.label);
  /** read a token/key file (PATHS, never values); null = unreadable */
  const tokenOf = (file: string): string | null => {
    try {
      return readFileSync(file, "utf8").trim();
    } catch {
      return null;
    }
  };
  const server = Bun.serve({
    hostname: "0.0.0.0",
    port: input.port ?? settings.hub.ports?.buckle ?? 4111,
    fetch: async (req) => {
      const startedAt = Date.now();
      const tp = continueTraceparent(req.headers.get("traceparent"));
      const done = (res: Response): Response => {
        exportSpan({
          name: `${req.method} ${new URL(req.url).pathname}`,
          traceparent: tp,
          startedAt,
          endedAt: Date.now(),
          attributes: { "http.status": res.status, "buckle.label": settings.hub.label },
        });
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
        if (principal !== null)
          return done(
            await forwardChat(settings, metrics, live, principal, req, tp),
          );
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
        return done(
          Response.json(await buildCatalog(settings, tp), {
            headers: { "cache-control": "no-store" },
          }),
        );
      }
      if (pathname === "/v1/stats") {
        const denied = guard("stats.read");
        if (denied !== null) return done(denied);
        return done(
          Response.json(
            await federatedStats(settings, live, tokenOf),
            { headers: { "cache-control": "no-store" } },
          ),
        );
      }
      if (pathname === "/v1/tree") {
        const denied = guard("tree.read");
        if (denied !== null) return done(denied);
        const tokenOf: (file: string) => string | null = (file) => {
          try {
            return readFileSync(file, "utf8").trim();
          } catch {
            return null;
          }
        };
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

export async function main(
  paths: SettingsPaths & { port?: number },
) {
  const settings = await loadSettings(paths);
  const port = paths.port ?? settings.hub.ports?.buckle ?? 4111;
  bootServer({ settings, port });
  console.log(
    `fleet-buckle ${settings.hub.label} on :${port} (trace id ${newTraceId()})`,
  );
}

import { resolveSettingsPaths } from "./buckle.server.settings.ts";

if (import.meta.main) {
  const paths = resolveSettingsPaths(process.argv.slice(2));
  await main(paths);
}
