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
function parseTraceparent(inbound: string | null): Traceparent | null {
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

/** one exported span, (exported as OTLP/HTTP protobuf) */
const SpanEndSchema = z
  .object({
    traceparent: z.string().min(1),
    name: z.string().min(1),
    startedAt: z.number().int().min(0),
    endedAt: z.number().int().min(0),
    attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();
type SpanEnd = z.output<typeof SpanEndSchema>;

// ── hand-rolled OTLP/HTTP protobuf (Jaeger accepts protobuf only) ──
const enc = new TextEncoder();
function varint(n: number | bigint): number[] {
  let v = BigInt(n);
  const out: number[] = [];
  while (v > 0x7fn) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}
/** length-delimited field */
function ld(field: number, bytes: ArrayLike<number>): number[] {
  return [...varint((field << 3) | 2), ...varint(bytes.length), ...Array.from(bytes)];
}
function vi(field: number, n: number | bigint): number[] {
  return [...varint(field << 3), ...varint(n)];
}
function fx64(field: number, n: bigint): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return [...varint((field << 3) | 1), ...b];
}
function hexBytes(h: string): number[] {
  return (h.match(/../g) ?? []).map((x) => parseInt(x, 16));
}
function kv(key: string, value: string): number[] {
  return [...ld(1, enc.encode(key)), ...ld(2, ld(1, enc.encode(value)))];
}

/** encode one span as an OTLP ExportTraceServiceRequest (protobuf) */
export function encodeOtlpSpan(span: SpanEnd): Uint8Array {
  const [t = "", s = ""] = span.traceparent.split("-").slice(1, 3);
  const attrs = Object.entries(span.attributes ?? {}).flatMap(([k, v]) => ld(9, kv(k, String(v))));
  const sp = [
    ...ld(1, hexBytes(t)),
    ...ld(2, hexBytes(s)),
    ...ld(5, enc.encode(span.name)),
    ...vi(6, 1),
    ...fx64(7, BigInt(span.startedAt) * 1_000_000n),
    ...fx64(8, BigInt(span.endedAt) * 1_000_000n),
    ...attrs,
  ];
  const scopeSpans = [...ld(1, ld(1, enc.encode("fleet-buckle"))), ...ld(2, sp)];
  const resource = ld(1, kv("service.name", "fleet-buckle"));
  return Uint8Array.from(ld(1, [...ld(1, resource), ...ld(2, scopeSpans)]));
}

/** fire-and-forget OTLP/HTTP PROTOBUF export (jaeger :4318/v1/traces).
 *  Sink url from settings (telemetry.otlp_url). Failures (transport OR
 *  non-2xx) are LOGGED faults, never silent, never fatal. */
export function exportSpan(end: SpanEnd, settings: BuckleSettings): void {
  const span = SpanEndSchema.parse(end);
  const base = settings.telemetry.otlp_url;
  if (base === undefined) return; // no sink configured
  void fetch(`${base.replace(/\/$/, "")}/v1/traces`, {
    method: "POST",
    headers: { "content-type": "application/x-protobuf" },
    body: encodeOtlpSpan(span),
  })
    .then((res) => {
      if (!res.ok) logFault("otlp.export", base, { kind: "io", detail: `HTTP ${res.status}` });
    })
    .catch((e: unknown) => {
      logFault("otlp.export", base, classifyFault(e));
    });
}
