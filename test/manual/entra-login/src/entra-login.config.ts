import { z } from "zod";
import { FaultSchema, fault } from "./entra-login.fault.ts";

/** Runtime config shape — machine file (0600, never committed; the
 *  committed entra-login.example.json carries placeholders only).
 *  mode names follow the P0.2c contract in tasks/plan.md. */
export const ConfigSchema = z.object({
  clientId: z.string().uuid(),
  tenantId: z.string().uuid(),
  /** the APIM API scope (api://…/access_as_user or .default) — never a Graph scope */
  scope: z.string().min(3),
  gatewayUrl: z.url(),
  lane: z.string().min(1),
  mode: z.enum(["url-pat", "bearer-pat"]),
  /** local 0600 file holding the personal Copilot PAT */
  patFile: z.string().min(1),
  claudeBin: z.string().default("claude"),
});
export type Config = z.output<typeof ConfigSchema>;

export const ConfigResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: ConfigSchema }),
  z.object({ ok: z.literal(false), fault: FaultSchema }),
]);
export type ConfigResult = z.output<typeof ConfigResultSchema>;

export const parseConfig = (raw: unknown): ConfigResult => {
  const parsed = ConfigSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const [first] = parsed.error.issues;
  if (!first) return { ok: false, fault: fault("config-parse", "unspecified shape error") };
  const path = first.path.join(".");
  return { ok: false, fault: fault("config-parse", `${path}: ${first.message}`) };
};
