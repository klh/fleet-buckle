// fault.ts — proper error decomposition and management. THE single
// place a throw is caught: every other module composes typed Fault
// values instead of try/catch (the no-try-catch law — enforced by
// tools/src/buckle.check-laws.ts). One seam, httpSend, turns every
// outbound fetch outcome into either a Response or a Fault; thin
// readers (text/json) classify body failures the same way.
import { z } from "zod";
import { Fault } from "./schemas/buckle.fault.zod.ts";

/** map any thrown value onto the taxonomy — total, never rethrows */
export function classifyFault(e: unknown): Fault {
  if (e instanceof Error) {
    if (e.name === "AbortError" || e.name === "TimeoutError") return { kind: "timeout" };
    if (e instanceof SyntaxError) return { kind: "malformed", detail: e.message };
    // Bun's fetch failures are TypeError("fetch failed…") — nothing
    // answered; anything else with a message is named io
    if (e.name === "TypeError") return { kind: "unreachable" };
    return { kind: "io", detail: `${e.name}: ${e.message}` };
  }
  return { kind: "io", detail: String(e) };
}

/** observe a fault: one structured line, never a silent swallow.
 *  Surfaced here so seams can name WHERE and WHO failed. */
export function logFault(seam: string, subject: string, fault: Fault): void {
  console.error(JSON.stringify({ seam, subject, fault }));
}

/** errno-guarded run: a fault carrying the given errno code yields
 *  null (the "absent" answer); every other fault rethrows — the
 *  value survives on success. THE catch boundary for fs existence
 *  guards (EEXIST/ENOENT…). */
export async function errnoOr<T>(run: () => Promise<T>, code: string): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Error && "code" in e && typeof e.code === "string" && e.code === code)
      return null;
    throw e;
  }
}

/** run() and, if it faults, hand the TYPED fault to the caller's
 *  policy (cleanup-and-rethrow composes here, not at the call site) */
export function attempt<T>(run: () => T, failed: (fault: Fault) => T): T {
  try {
    return run();
  } catch (e) {
    return failed(classifyFault(e));
  }
}

const _HttpSendResultSchema = z.union([
  z.object({ ok: z.literal(true), response: z.instanceof(Response) }),
  z.object({ ok: z.literal(false), fault: Fault }),
]);
type HttpSendResult = z.output<typeof _HttpSendResultSchema>;

/** THE outbound seam: fetch with a bounded wait, every failure a typed
 *  Fault. This is the one try/catch in src/ (the law's only sanction):
 *  it catches to CLASSIFY, never to swallow. */
export async function httpSend(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<HttpSendResult> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: true, response };
  } catch (e) {
    return { ok: false, fault: classifyFault(e) };
  }
}

/** read a response body as text, classifying a failed read */
export async function bodyText(
  r: HttpSendResult,
): Promise<{ ok: true; text: string } | { ok: false; fault: Fault }> {
  if (!r.ok) return r;
  try {
    return { ok: true, text: await r.response.text() };
  } catch (e) {
    return { ok: false, fault: classifyFault(e) };
  }
}

/** parse JSON text without throwing — malformed text decomposes to a
 *  fault instead of an exception (this is the only JSON.parse catch
 *  in src/; the no-try-catch law's sanctioned boundary). */
export function parseJson(text: string): { ok: true; data: unknown } | { ok: false; fault: Fault } {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (e) {
    return { ok: false, fault: classifyFault(e) };
  }
}

/** read a response body as parsed JSON, classifying failed reads and
 *  malformed payloads alike */
export async function bodyJson(
  r: HttpSendResult,
): Promise<{ ok: true; data: unknown } | { ok: false; fault: Fault }> {
  if (!r.ok) return r;
  try {
    return { ok: true, data: await r.response.json() };
  } catch (e) {
    return { ok: false, fault: classifyFault(e) };
  }
}

// ── B05 retry/attempt policy ─────────────────────────────────────
// ONE attempt budget spans Pi → gateway(buckle) → provider/litellm.
// Budget math: buckle makes exactly ONE upstream attempt per request
// (MAX_ATTEMPTS=1) bounded by min(engine_ms|hop_ms, chain deadline).
// Retries/fallback belong to ONE layer (the caller's pre-first-chunk
// choice of another deployment); layers below must not retry silently,
// else worst case = attempts_pi × attempts_gw × attempts_provider.
// Pre-first-chunk: a retryable fault MAY fall to another deployment
// within the remaining budget. Post-first-chunk: never fall back —
// the visible generation is marked interrupted (see interruptibleStream
// in settle) so two deployments are never spliced into one turn.
export const MAX_ATTEMPTS = 1;

/** faults where nothing was served and trying elsewhere is safe */
export function retryableBeforeFirstChunk(fault: Fault): boolean {
  return fault.kind === "unreachable" || fault.kind === "timeout";
}

/** Retry-After (delta-seconds) → whole seconds ≥1; absent/garbage → 1.
 *  Honoured as the minimum wait; capped so it never exceeds `capS`. */
export function retryAfterSeconds(header: string | null, capS = 300): number {
  const n = Number(header ?? "");
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(Math.ceil(n), capS);
}

/** may another attempt start? bounded count AND time remaining */
export function mayAttempt(attemptsMade: number, deadlineMs: number, now = Date.now()): boolean {
  return attemptsMade < MAX_ATTEMPTS && deadlineMs - now > 0;
}
