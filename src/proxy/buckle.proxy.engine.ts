// proxy/buckle.proxy.engine.ts — the ENGINE leg of the forward loop: the
// one place buckle talks to its litellm. Provider-origin models ride
// here: body bytes verbatim, the W3C trace CONTINUED, bounded waits.
// Outcome is a zod-typed union the caller maps into client responses;
// every type here is zod-derived (the type law).
import { z } from "zod";
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { bodyText, httpSend, parseJson } from "../fault.ts";
import type { TokenReader } from "../federation/buckle.federation.peer.ts";
import { continueTraceparent } from "../trace/buckle.trace.export.ts";
import { LegOutcomeSchema, type LegOutcome } from "./buckle.proxy.outcome.ts";

/** the engine outcome, mapped by the caller into client responses.
 *  The union is the shared leg outcome (buckle.proxy.outcome.ts) —
 *  served carries servedBy: provenance is named AT THE SOURCE so the
 *  pipeline's served mapping is ONE surface for every leg. */
type EngineOutcome = LegOutcome;

/** the engine outcome for a unit with no engine configured — the
 *  leg answers a typed fault, never a crash (relay-only units) */
const noEngineOutcome = (): EngineOutcome => ({
  kind: "fault",
  fault: { kind: "malformed", detail: "no engine configured on this unit" },
});

/** total_tokens out of an upstream chat body (0 when absent/unparseable) */
const UsageBody = z
  .object({ usage: z.object({ total_tokens: z.number() }).optional() })
  .passthrough();

export function usageOf(text: string): number {
  // non-JSON upstream body: no token count, still a passthrough
  const json = parseJson(text);
  if (!json.ok) return 0;
  const parsed = UsageBody.safeParse(json.data);
  return parsed.success ? (parsed.data.usage?.total_tokens ?? 0) : 0;
}

/** POST a chat to the engine, verbatim body, trace continued.
 *  When keys.engine is configured AND readable, the gate is ON: the
 *  engine (litellm master_key) refuses anonymous and wrong-key calls.
 *  A missing/unreadable file means NO header (stub engines are open). */
/** the tag header litellm's request logs + policy engine read
 *  (litellm_pre_call_utils x-litellm-tags): buckle's attribution,
 *  stamped where the GUI can see it — lane + principal facts */
const LITELLM_TAGS_HEADER = "x-litellm-tags";

/** one engine call, bundled — the chat seam's whole ask */
const _EngineCall = z.object({
  settings: z.custom<BuckleSettings>(),
  raw: z.string(),
  traceparent: z.string(),
  tokenOf: z.custom<TokenReader>(),
  enginePath: z.string(),
  fleetTags: z.string().default(""),
});
type EngineCall = z.output<typeof _EngineCall>;

export async function engineChat(call: EngineCall): Promise<EngineOutcome> {
  const { settings, raw, traceparent, tokenOf, enginePath, fleetTags } = call;
  if (settings.engine === undefined) return noEngineOutcome();
  const engine = `${settings.engine.url.replace(/\/$/, "")}${enginePath}`;
  const engineToken = settings.keys?.engine !== undefined ? tokenOf(settings.keys.engine) : null;
  const sent = await httpSend(
    engine,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        traceparent: continueTraceparent(traceparent),
        ...(fleetTags !== "" ? { [LITELLM_TAGS_HEADER]: fleetTags } : {}),
        ...(engineToken !== null ? { authorization: `Bearer ${engineToken}` } : {}),
      },
      body: raw,
    },
    settings.timeouts.engine_ms,
  );
  if (!sent.ok) return { kind: "fault", fault: sent.fault };
  const body = await bodyText(sent);
  if (!body.ok) return { kind: "fault", fault: body.fault };
  return LegOutcomeSchema.parse({
    kind: "served",
    status: sent.response.status,
    text: body.text,
    contentType: sent.response.headers.get("content-type") ?? "application/json",
    servedBy: settings.hub.label,
  });
}
