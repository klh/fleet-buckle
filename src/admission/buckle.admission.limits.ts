// admission/buckle.admission.limits.ts — per-principal RPM
// enforcement (the in-loop thing "may it in"): a rolling 60s window
// (timestamps per principal), deny → 429 problem+json with
// Retry-After seconds. Ported from old admission.ts's philosophy at
// our scale: the router never queues blindly; the verdict is a typed
// value, the limiter never throws. Resolution: grant.limits.max_rpm,
// falling back to the tier matching the principal's KIND; no cap
// anywhere = admit. The 60s window is DEFINITIONAL (it is what
// "per minute" means), not a tunable.
import { z } from "zod";
import type {
  BuckleGrant,
  BuckleTier,
} from "../schemas/buckle.access.zod.ts";

const WINDOW_MS = 60_000;

/** the admission verdict — a zod discriminated union (the type law:
 * every data type is zod-derived, never hand-written) */
export const RateVerdict = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(true) }).strict(),
  z
    .object({
      allowed: z.literal(false),
      retryAfterS: z.number().int().min(1),
    })
    .strict(),
]);
export type RateVerdict = z.output<typeof RateVerdict>;

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
