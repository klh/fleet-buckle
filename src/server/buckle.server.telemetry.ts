// buckle.server.telemetry.ts — OTel/Jaeger tracing ids THROUGH
// everything, minimally and honestly: W3C traceparent continues across
// hops (an inbound id rides on with a new span id; no inbound id
// mints a new trace), and finished request spans export OTLP/HTTP to
// OTEL_EXPORTER_OTLP_ENDPOINT (jaeger) fire-and-forget — telemetry
// never blocks or breaks a request.
import { z } from "zod";

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

const hex = (bytes: number): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex");

export function newTraceId(): string {
  return hex(16);
}

function newSpanId(): string {
  return hex(8);
}

/** Continue (or mint) the W3C trace: same trace id in, new span id out. */
export function continueTraceparent(incoming: string | null): string {
  const parts = (incoming ?? "").split("-");
  const [ver, trace, span, flags] = parts;
  if (parts.length === 4 && ver === "00" && TRACE_ID.test(trace ?? "") && SPAN_ID.test(span ?? "") && (flags ?? "").length === 2)
    return `00-${trace}-${newSpanId()}-${flags}`;
  return `00-${newTraceId()}-${newSpanId()}-01`;
}

export function traceIdOf(traceparent: string): string {
  return traceparent.split("-")[1] ?? newTraceId();
}

export const SpanEndSchema = z.object({
  name: z.string().min(1),
  traceparent: z.string().min(1),
  /** epoch ms */
  startedAt: z.number().int().min(0),
  endedAt: z.number().int().min(0),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type SpanEnd = z.output<typeof SpanEndSchema>;

/** Fire-and-forget OTLP/HTTP JSON export (jaeger :4318/v1/traces). */
export function exportSpan(end: SpanEnd): void {
  const endpoint = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  if (!endpoint) return; // no sink configured — traces still flow on the wire headers
  const [t, s] = end.traceparent.split("-");
  void fetch(`${endpoint.replace(/\/$/, "")}/v1/traces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "fleet-buckle" } }] },
          scopeSpans: [
            {
              scope: { name: "fleet-buckle" },
              spans: [
                {
                  traceId: t,
                  spanId: s,
                  name: end.name,
                  kind: 2,
                  startTimeUnixNano: end.startedAt * 1e6,
                  endTimeUnixNano: end.endedAt * 1e6,
                  attributes: Object.entries(end.attributes ?? {}).map(
                    ([key, value]) =>
                      ({ key, value: typeof value === "string" ? { stringValue: value } : typeof value === "boolean" ? { boolValue: value } : { intValue: value } }),
                  ),
                },
              ],
            },
          ],
        },
      ],
    }),
  }).catch(() => {
    // telemetry must never break a request
  });
}
