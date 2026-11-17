import type { Config } from "./entra-login.config.ts";
import { FaultSchema, fault } from "./entra-login.fault.ts";
import { z } from "zod";

/** the gateway's /v1/models face — { hub, models: […] }; only the
 *  array matters here (a 200 with a wrong shape is still a refusal) */
const PreflightBodySchema = z.object({ models: z.array(z.unknown()) }).passthrough();

/** Preflight rides the SAME carrier the CLI will use — it must fail
 *  BEFORE a session launches, with a reason a human can act on. */
export const PreflightResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), models: z.number().int().min(0) }),
  z.object({ ok: z.literal(false), fault: FaultSchema }),
]);
export type PreflightResult = z.output<typeof PreflightResultSchema>;

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
  const raw = await response.json().catch(() => null);
  const body = PreflightBodySchema.safeParse(raw);
  if (!body.success) {
    return { ok: false, fault: fault("preflight-failed", "catalog shape unexpected") };
  }
  return { ok: true, models: body.data.models.length };
};
