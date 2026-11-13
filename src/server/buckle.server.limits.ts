// buckle.server.limits.ts — per-principal RPM enforcement: a rolling
// 60s window (timestamps per principal), deny → 429 problem+json with
// Retry-After seconds. Resolution: grant.limits.max_rpm, falling back
// to the tier matching the principal's KIND; no cap anywhere = admit.
// Telemetry never gates traffic and the limiter never throws.
const WINDOW_MS = 60_000;

export type RateVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterS: number };

export function createLimiter(
  now: () => number = Date.now,
): {
  admit(principal: string, maxRpm: number): RateVerdict;
} {
  const hits = new Map<string, number[]>();
  return {
    admit(principal, maxRpm) {
      if (maxRpm <= 0) return { allowed: true };
      const t = now();
      const window = (hits.get(principal) ?? []).filter((at) => t - at < WINDOW_MS);
      if (window.length >= maxRpm) {
        const retryAfterS = Math.max(
          1,
          Math.ceil((window[0]! + WINDOW_MS - t) / 1000),
        );
        return { allowed: false, retryAfterS };
      }
      window.push(t);
      hits.set(principal, window);
      return { allowed: true };
    },
  };
}

import type { BuckleGrant, BuckleTier } from "../schemas/buckle.access.zod.ts";

/** grant.limits.max_rpm → tier-by-kind → none (0). */
export function resolveRpmCap(
  grant: Pick<BuckleGrant, "limits"> | undefined,
  principalKind: string | undefined,
  tiers: Pick<BuckleTier, "label" | "kind" | "max_rpm">[],
): number {
  const grantCap = grant?.limits?.max_rpm;
  if (grantCap !== undefined) return grantCap;
  if (principalKind !== undefined) {
    const tier = tiers.find((t) => t.kind === principalKind);
    if (tier?.max_rpm !== undefined) return tier.max_rpm;
  }
  return 0;
}
