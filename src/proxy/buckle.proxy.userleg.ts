// proxy/buckle.proxy.userleg.ts — the BYOC (bring-your-own-credential)
// leg: a user_token provider forwards VERBATIM, with the CALLER's
// /w/<lane>/<token> credential as the upstream Bearer. No unit key
// exists for these seats — the token lives on the dev's machine,
// rides the URL, and is relayed here exactly once (never stored,
// never logged — the leg sees it, sends it, drops it).
//
// TWO carriers, engine FIRST when one is configured (generic: any
// engine, any user_token provider — litellm today):
//   engine  the unit's engine (litellm) fronts the provider with a
//           PASS-THROUGH endpoint (verified live on litellm 1.103.0:
//           include_subpath + forward_headers relays the incoming
//           Authorization verbatim; model deployments CANNOT carry
//           the user token — a deployment key replaces it). The path
//           convention is the contract: /v1/byoc/<label>/<subpath>
//           (the generator emits one pass-through row per seat).
//           A BYOC seat's engine rides UNGATED on the isolated unit
//           network — a master_key gate would eat the user token
//           (mixed gated+BYOC units are a litellm virtual-keys case,
//           deliberately not this seam).
//   direct  no engine: the leg relays straight to the provider with
//           the registry's catalog headers attached.
// Body bytes verbatim, the W3C trace CONTINUED. The outcome shape is
// the engine leg's (served|fault) so settleServed maps both through
// ONE surface.
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { bodyText, httpSend } from "../fault.ts";
import { continueTraceparent } from "../trace/buckle.trace.export.ts";
import { KNOWN_PROVIDERS, type KnownProviderLabel } from "../schemas/buckle.provider.registry.zod.ts";
import { ENGINE_PATH, type ChatRoute } from "../context/buckle.context.inject.ts";
import { LegOutcomeSchema, type LegOutcome } from "./buckle.proxy.outcome.ts";

/** the BYOC leg outcome — the shared leg union (the pipeline's
 *  settle surface consumes every leg identically) */
type UserLegOutcome = LegOutcome;

/** one BYOC call, bundled — the leg's whole ask. token is the
 *  CALLER's credential (the /w/ segment); provider the resolved
 *  settings row (url, dialect, user_token=true guaranteed by the
 *  caller); label its settings key (catalog headers resolve from
 *  the registry by label). Derived from the one signature (the
 *  Parameters idiom — never a hand-written mirror). */
export async function userChat(call: {
  settings: BuckleSettings;
  label: string;
  url: string;
  raw: string;
  traceparent: string;
  route: ChatRoute;
  token: string;
}): Promise<UserLegOutcome> {
  const engine = call.settings.engine?.url.replace(/\/$/, "");
  // the registry headers ride BOTH carriers — the engine pass-through
  // relays incoming headers verbatim, so the copilot seat's integration
  // id must be on the engine leg too (without it Copilot 400s /v1/
  // messages with "no model endpoints available given user constraints")
  const extra =
    KNOWN_PROVIDERS[call.label as KnownProviderLabel]?.catalog_headers ?? {};
  const sent =
    engine !== undefined
      ? await relayTo(
          call,
          `${engine}/v1/byoc/${call.label}${ENGINE_PATH[call.route]}`,
          extra,
        )
      : await relayTo(
          call,
          `${call.url.replace(/\/$/, "")}${ENGINE_PATH[call.route]}`,
          extra,
        );
  if (!sent.ok) return { kind: "fault", fault: sent.fault };
  const body = await bodyText(sent);
  if (!body.ok) return { kind: "fault", fault: body.fault };
  return LegOutcomeSchema.parse({
    kind: "served",
    status: sent.response.status,
    text: body.text,
    contentType: sent.response.headers.get("content-type") ?? "application/json",
    servedBy: call.settings.hub.label,
  });
}

/** the ONE relay carrier both BYOC modes ride: verbatim body,
 *  continued trace, the caller's token as the upstream Bearer —
 *  only the TARGET (engine pass-through vs provider direct) and
 *  any registry headers differ. */
function relayTo(
  call: Parameters<typeof userChat>[0],
  target: string,
  extraHeaders: Record<string, string>,
) {
  return httpSend(
    target,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        traceparent: continueTraceparent(call.traceparent),
        ...extraHeaders,
        authorization: `Bearer ${call.token}`,
      },
      body: call.raw,
    },
    call.settings.timeouts.engine_ms,
  );
}
