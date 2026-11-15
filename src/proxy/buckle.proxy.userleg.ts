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
import { Fault } from "../schemas/buckle.fault.zod.ts";
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { bodyText, httpSend } from "../fault.ts";
import { continueTraceparent } from "../trace/buckle.trace.export.ts";
import { KNOWN_PROVIDERS, type KnownProviderLabel } from "../schemas/buckle.provider.registry.zod.ts";
import { ENGINE_PATH, type ChatRoute } from "../context/buckle.context.inject.ts";

/** the BYOC leg outcome — structurally the engine leg's union (the
 *  pipeline's settle surface consumes both identically) */
type UserLegOutcome =
  | { kind: "served"; status: number; text: string; contentType: string; servedBy: string }
  | { kind: "fault"; fault: Fault };

/** one BYOC call, bundled — the leg's whole ask. token is the
 *  CALLER's credential (the /w/ segment); provider the resolved
 *  settings row (url, dialect, user_token=true guaranteed by the
 *  caller); label its settings key (catalog headers resolve from
 *  the registry by label). */
export async function userChat(call: {
  settings: BuckleSettings;
  label: string;
  url: string;
  raw: string;
  traceparent: string;
  route: ChatRoute;
  token: string;
}): Promise<UserLegOutcome> {
  const sent =
    call.settings.engine !== undefined
      ? await engineRelay(call)
      : await directRelay(call);
  if (!sent.ok) return { kind: "fault", fault: sent.fault };
  const body = await bodyText(sent);
  if (!body.ok) return { kind: "fault", fault: body.fault };
  return {
    kind: "served",
    status: sent.response.status,
    text: body.text,
    contentType: sent.response.headers.get("content-type") ?? "application/json",
    servedBy: call.settings.hub.label,
  };
}

/** the engine carrier: the caller's token rides AS the incoming
 *  Authorization — the engine's pass-through endpoint forwards it
 *  verbatim to the seat (the engine is ungated; a master key here
 *  would replace the user credential at the upstream seat). */
async function engineRelay(call: {
  settings: BuckleSettings;
  label: string;
  raw: string;
  traceparent: string;
  route: ChatRoute;
  token: string;
}) {
  const engine = call.settings.engine?.url.replace(/\/$/, "") ?? "";
  // the BYOC path convention (the generator's pass-through rows)
  const target = `${engine}/v1/byoc/${call.label}${ENGINE_PATH[call.route]}`;
  return httpSend(
    target,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        traceparent: continueTraceparent(call.traceparent),
        authorization: `Bearer ${call.token}`,
      },
      body: call.raw,
    },
    call.settings.timeouts.engine_ms,
  );
}

/** the direct carrier: verbatim relay to the provider, registry
 *  catalog headers attached (the Copilot seat demands its
 *  integration id). */
async function directRelay(call: {
  settings: BuckleSettings;
  label: string;
  url: string;
  raw: string;
  traceparent: string;
  route: ChatRoute;
  token: string;
}) {
  const target = `${call.url.replace(/\/$/, "")}${ENGINE_PATH[call.route]}`;
  const known = KNOWN_PROVIDERS[call.label as KnownProviderLabel];
  return httpSend(
    target,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        traceparent: continueTraceparent(call.traceparent),
        ...(known?.catalog_headers ?? {}),
        authorization: `Bearer ${call.token}`,
      },
      body: call.raw,
    },
    call.settings.timeouts.engine_ms,
  );
}
