// buckle.kit.health.ts — shared polling helpers for the fleet-health
// sidecar faces in playwright specs: TOTAL reads (a refused/reset
// moment is "not yet", never a fail) against the HealthFace and
// HealthVerdict contracts from @fleet/health.
import { HealthFace, HealthVerdict } from "@fleet/health";

export type { HealthFace, HealthVerdict };

export async function face(port: number): Promise<string> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`);
    return HealthFace.parse(await r.json()).state;
  } catch {
    return "connecting";
  }
}

export async function verdict(port: number): Promise<HealthVerdict | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/status`);
    return HealthVerdict.parse(await r.json());
  } catch {
    return null;
  }
}
