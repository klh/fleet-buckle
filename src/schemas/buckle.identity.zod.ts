// buckle.identity.zod.ts — principal -> engine identity mapping and route families.
import { z } from "zod";
import { BucklePrincipalId, BucklePrincipalKind } from "./buckle.principal.zod.ts";

export const BuckleRouteFamily = z.enum(["chat", "responses", "embeddings", "models", "admin", "worker"]);
export type BuckleRouteFamily = z.output<typeof BuckleRouteFamily>;

/** Principal -> scoped engine key / teams. Raw key material never appears here: only a reference. */
export const BuckleEngineIdentity = z
  .object({
    principalId: BucklePrincipalId,
    kind: BucklePrincipalKind,
    groups: z.array(z.string().min(1)).default([]),
    engineKeyRef: z.string().min(1),
    teams: z.array(z.string().min(1)).default([]),
    routeFamilies: z.array(BuckleRouteFamily).min(1),
  })
  .strict();
export type BuckleEngineIdentity = z.output<typeof BuckleEngineIdentity>;
