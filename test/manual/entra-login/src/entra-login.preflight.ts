import type { Config } from "./entra-login.config.ts";
import { fault, type Fault } from "./entra-login.fault.ts";

/** Preflight rides the SAME carrier the CLI will use — it must fail
 *  BEFORE a session launches, with a reason a human can act on. */
export type PreflightResult = { ok: true; models: number } | { ok: false; fault: Fault };

export const preflight = async (
  config: Config,
  pat: string,
  entraToken: string,
): Promise<PreflightResult> => {
  const base =
    config.mode === "url-pat"
      ? `${config.gatewayUrl}/w/${config.lane}/${pat}`
      : `${config.gatewayUrl}/w/${config.lane}`;
  const headers: Record<string, string> =
    config.mode === "url-pat"
      ? { authorization: `Bearer ${entraToken}` }
      : { authorization: `Bearer ${pat}` };
  // bearer-pat against buckle-direct: the PAT must ride Authorization;
  // APIM's Entra validation adds its own header contract when it lands.
  const response = await fetch(`${base}/v1/models`, { headers }).catch(() => null);
  if (!response) return { ok: false, fault: fault("preflight-failed", "gateway unreachable") };
  if (response.status !== 200) {
    return { ok: false, fault: fault("preflight-failed", `gateway answered ${response.status}`) };
  }
  const body = (await response.json().catch(() => null)) as { models?: unknown[] } | null;
  if (!body || !Array.isArray(body.models)) {
    return { ok: false, fault: fault("preflight-failed", "catalog shape unexpected") };
  }
  return { ok: true, models: body.models.length };
};
