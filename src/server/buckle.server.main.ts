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
import { forwardChat } from "./buckle.server.forward.ts";
import { createMetrics } from "./buckle.server.metrics.ts";

export function bootServer(input: { settings: BuckleSettings; port?: number }) {
  const { settings } = input;
  const metrics = createMetrics(settings.hub.label);
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
      if (pathname === "/v1/chat/completions" && req.method === "POST")
        return done(await forwardChat(settings, metrics, req, tp));
      if (pathname === "/metrics")
        return done(
          new Response(metrics.render(), {
            headers: { "content-type": "text/plain; version=0.0.4" },
          }),
        );
      if (pathname === "/v1/models")
        return done(
          Response.json(await buildCatalog(settings, tp), {
            headers: { "cache-control": "no-store" },
          }),
        );
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
