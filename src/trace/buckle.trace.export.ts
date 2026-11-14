// trace/buckle.trace.export.ts — W3C trace context (ported from old buckle's
// trace.ts: correlation ONLY — a trace id is never identity, authz, or
// a credential; malformed input NEVER propagates; every outbound leg
// gets a FRESH span id inside the same trace). The OTLP export is
// settings-driven (telemetry.otlp_url; absent = off — traces still
// flow on the wire headers either way).
import { z } from "zod";
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { classifyFault, logFault } from "../fault.ts";

/** a traceparent: trace id + span id + flags — parseable, never trusted */
const TraceparentSchema = z
  .object({
    traceId: z.string().regex(/^[0-9a-f]{32}$/),
    spanId: z.string().regex(/^[0-9a-f]{16}$/),
    flags: z.string().regex(/^[0-9a-f]{2}$/),
  })
  .strict();
type Traceparent = z.output<typeof TraceparentSchema>;

/** canonical parse: lowercase, all-zero ids rejected, version ff
 *  rejected, malformed input never propagates (null = root a fresh
 *  trace — garbage must not ride the wire) */
function parseTraceparent(
  inbound: string | null,
): Traceparent | null {
  if (inbound === null) return null;
  const parts = inbound.trim().toLowerCase().split("-");
  if (parts.length !== 4) return null;
  const [version, traceId, spanId, flags] = parts;
  if (version === "ff") return null;
  if (traceId === "0".repeat(32) || spanId === "0".repeat(16)) return null;
  const parsed = TraceparentSchema.safeParse({ traceId, spanId, flags });
  return parsed.success ? parsed.data : null;
}

/** continue the trace: SAME trace id, FRESH span id (per hop, per
 *  outbound attempt). An absent/invalid parent roots a fresh trace. */
export function continueTraceparent(inbound: string | null): string {
  const parent = parseTraceparent(inbound);
  const traceId = parent?.traceId ?? freshId(32);
  return `00-${traceId}-${freshId(16)}-01`;
}

/** a fresh trace id (hex, 32) — the boot log names it */
export function newTraceId(): string {
  return freshId(32);
}

/** the trace id riding a traceparent (null when malformed) */
export function traceIdOf(tp: string): string | null {
  return parseTraceparent(tp)?.traceId ?? null;
}

function freshId(hex: number): string {
  let s = "";
  for (let i = 0; i < hex; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** one exported span, in OTLP/HTTP JSON shape */
const SpanEndSchema = z
  .object({
    traceparent: z.string().min(1),
    name: z.string().min(1),
    startedAt: z.number().int().min(0),
    endedAt: z.number().int().min(0),
    attributes: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
  })
  .strict();
type SpanEnd = z.output<typeof SpanEndSchema>;

/** fire-and-forget OTLP/HTTP JSON export (jaeger :4318/v1/traces).
 *  The sink url comes from settings (telemetry.otlp_url) — ONE home.
 *  Export failures are LOGGED faults, never silent, never fatal: the
 *  serving path does not depend on the sink. */
export function exportSpan(end: SpanEnd, settings: BuckleSettings): void {
  const span = SpanEndSchema.parse(end);
  const base = settings.telemetry.otlp_url;
  if (base === undefined) return; // no sink configured — traces still flow on the wire headers
  const [t, s] = span.traceparent.split("-");
  void fetch(`${base.replace(/\/$/, "")}/v1/traces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "fleet-buckle" } }],
          },
          scopeSpans: [
            {
              scope: { name: "fleet-buckle" },
              spans: [
                {
                  traceId: t,
                  spanId: s,
                  name: span.name,
                  kind: 1,
                  startTimeUnixNano: span.startedAt * 1_000_000,
                  endTimeUnixNano: span.endedAt * 1_000_000,
                  attributes: Object.entries(span.attributes ?? {}).map(
                    ([key, value]) => ({ key, value: { stringValue: String(value) } }),
                  ),
                },
              ],
            },
          ],
        },
      ],
    }),
  }).catch((e: unknown) => {
    logFault("otlp.export", base, classifyFault(e));
  });
}
