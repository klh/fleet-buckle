// buckle.proxy.gate.ts — steps 3 + 3.5 of the forward loop:
// federated-model resolution and the BYOC admission gate. The model
// resolves in the PRINCIPAL'S federated view (own rows + peers their
// grant admits); a user_token provider demands the CALLER's /w/
// credential, and that credential admits nothing else — a peer model
// a grant does not admit is indistinguishable from an unknown model
// (no leak). Extracted from the pipeline (which keeps the loop
// composition); refusal decomposes to a problem, a ride carries the
// resolved origin for dispatch.
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { BuckleModelWire } from "../schemas/buckle.model.wire.zod.ts";
import { buildFederatedCatalog } from "../catalog/buckle.catalog.view.ts";
import { problemResponse } from "../problem.ts";
import type { ForwardCtx } from "./buckle.proxy.ctx.ts";

/** the verdict constructors — factory-typed (live values: a Response
 *  and the settings row ride them; never a fake z.custom parse) */
function refusedGate(response: Response) {
  return { kind: "refused" as const, response };
}
function rideGate(
  providerRow: NonNullable<BuckleSettings["providers"]>[string] | undefined,
  origin: OriginKind,
  originLabel: string,
) {
  return { kind: "ride" as const, providerRow, origin, originLabel };
}
export type ModelGate = ReturnType<typeof refusedGate> | ReturnType<typeof rideGate>;

/** where a resolved model originates (the wire schema's enum, derived) */
type OriginKind = BuckleModelWire extends { origin: { kind: infer K } } ? K : never;

export async function resolveModelGate(
  ctx: ForwardCtx,
  ask: { model: string; traceparent: string },
): Promise<ModelGate> {
  const { settings, principal, tokenOf } = ctx;
  const catalog = await buildFederatedCatalog(
    settings,
    principal,
    tokenOf,
    ask.traceparent,
    ctx.userToken,
  );
  const known = catalog.models.find((m) => m.id === ask.model);
  if (known === undefined)
    return refusedGate(
      problemResponse(
        "not-found",
        `model ${ask.model} is not served by this buckle`,
        // a BYOC seat's catalog rides the caller's token — without one
        // its rows are invisible; the refusal NAMES the contract
        ctx.userToken === null &&
          Object.values(settings.providers ?? {}).some((p) => p.user_token)
          ? "BYOC seats list their models only through your token: point the client at /w/<lane>/<token>/…"
          : undefined,
      ),
    );
  const providerRow =
    known.origin.kind === "provider" ? settings.providers?.[known.origin.label] : undefined;
  const byoc = providerRow !== undefined && providerRow.user_token;
  if (byoc && ctx.userToken === null)
    return refusedGate(
      problemResponse(
        "unauthenticated",
        "this model's provider requires the user token",
        "point the client at /w/<lane>/<token>/… (BYOC seat)",
      ),
    );
  if (!byoc && ctx.principal.startsWith("user:"))
    return refusedGate(
      problemResponse(
        "unauthenticated",
        "a principal key is required for this model",
        "the /w/ user token only admits BYOC providers",
      ),
    );
  return rideGate(providerRow, known.origin.kind, known.origin.label);
}
