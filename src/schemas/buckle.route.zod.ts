// buckle.route.zod.ts — the THREE wire dialects buckle speaks at its
// OWN faces ("chat" = /v1/chat/completions, "messages" = /v1/messages,
// "responses" = /v1/responses — the OpenAI Responses wire); everything
// else passes through verbatim — litellm owns every other
// wire. ONE home for the enum the judge facts, the pipeline stamp, and
// the settings context rules all compose (never a re-declared mirror).
import { z } from "zod";

export const ChatRouteSchema = z.enum(["chat", "messages", "responses"]);
export type ChatRoute = z.output<typeof ChatRouteSchema>;

/** provider-specific fields litellm's drop_params must NEVER be trusted
 *  to remove (plan.md B03): refused explicitly at our boundary. */
export const UNSAFE_PROVIDER_FIELDS = ["mcp_servers"] as const;

/** the request's capability ask, read off the wire body. `tools` =
 *  the call declares tools; `forcedTool` = it REQUIRES a tool call
 *  (tool_choice required/any/named) — dropping that is degradation. */
export const WireAsk = z
  .object({
    tools: z.array(z.unknown()).optional(),
    tool_choice: z.unknown().optional(),
  })
  .loose();

/** pure verdict: null = admissible, else the refusal reason. `supports`
 *  is the provider's own capabilities.supports row (meta, verbatim);
 *  an explicit `false` for tool_calls means tools would be dropped. */
export function wireRefusal(body: unknown, supports: Record<string, unknown> | undefined): string | null {
  if (typeof body !== "object" || body === null) return null;
  for (const f of UNSAFE_PROVIDER_FIELDS)
    if (f in body) return `field ${f} is provider-specific and is not forwarded; remove it`;
  const ask = WireAsk.safeParse(body);
  if (!ask.success) return null;
  const hasTools = (ask.data.tools?.length ?? 0) > 0;
  if (hasTools && supports?.["tool_calls"] === false)
    return "the model does not support tool calls; they would be silently dropped";
  return null;
}
