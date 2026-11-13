// buckle.server.engine.ts — the ENGINE leg of the forward loop: the
// one place buckle talks to its litellm. Provider-origin models ride
// here: body bytes verbatim, the W3C trace CONTINUED, bounded waits.
// Outcome is a zod-typed union the caller maps into client responses;
// every type here is zod-derived (the type law).
import { z } from "zod";
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { continueTraceparent } from "./buckle.server.telemetry.ts";

/** bounded waits: a hung engine must not hold the client forever */
export const ENGINE_TIMEOUT_MS = 120_000;

/** the engine base url: settings override ⊕ env ⊕ default */
export function engineUrl(settings: BuckleSettings): string {
  return (
    settings.engine?.url ??
    process.env["BUCKLE_ENGINE_URL"] ??
    "http://127.0.0.1:4000"
  );
}

/** the engine outcome, mapped by the caller into client responses */
export const EngineOutcome = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("served"),
      status: z.number().int(),
      text: z.string(),
      contentType: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("timeout") }).strict(),
  z.object({ kind: z.literal("unreachable") }).strict(),
]);
export type EngineOutcome = z.output<typeof EngineOutcome>;

/** total_tokens out of an upstream chat body (0 when absent/unparseable) */
const UsageBody = z
  .object({ usage: z.object({ total_tokens: z.number() }).optional() })
  .passthrough();

export function usageOf(text: string): number {
  try {
    const parsed = UsageBody.safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data.usage?.total_tokens ?? 0) : 0;
  } catch {
    return 0; // non-JSON upstream body: no token count, still a passthrough
  }
}

/** POST a chat to the engine, verbatim body, trace continued */
export async function engineChat(
  settings: BuckleSettings,
  raw: string,
  traceparent: string,
): Promise<EngineOutcome> {
  const engine = `${engineUrl(settings).replace(/\/$/, "")}/v1/chat/completions`;
  try {
    const upstream = await fetch(engine, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        traceparent: continueTraceparent(traceparent),
      },
      body: raw,
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
    });
    return {
      kind: "served",
      status: upstream.status,
      text: await upstream.text(),
      contentType: upstream.headers.get("content-type") ?? "application/json",
    };
  } catch (e) {
    if (
      e instanceof Error &&
      (e.name === "AbortError" || e.name === "TimeoutError")
    )
      return { kind: "timeout" };
    return { kind: "unreachable" };
  }
}
