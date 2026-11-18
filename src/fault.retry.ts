// fault.retry.ts — B05 retry/attempt policy (split from fault.ts)
import type { Fault } from "./schemas/buckle.fault.zod.ts";

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
