// context/buckle.context.inject.ts — the TWO sanctioned body
// rewrites, dialect-aware (chat + messages): the injection merge
// (the proven W3081 semantics) and the /w/<slug> lane pin. Values
// in files, shapes in schemas; a body the shape does not recognize
// rides UNTOUCHED — injection never corrupts what it does not
// understand.
import { z } from "zod";
import { parseJson } from "../fault.ts";
import type { ChatRoute } from "../schemas/buckle.route.zod.ts";

/** the wire dialects buckle speaks at its OWN faces (everything
 *  else passes through verbatim — litellm owns every other wire) */
export type { ChatRoute };
export const ENGINE_PATH: Record<ChatRoute, string> = {
  chat: "/v1/chat/completions",
  messages: "/v1/messages",
};

/** a chat body we may prepend into: messages is an array, everything
 *  else rides passthrough (the engine owns its own face) */
const InjectableChatBody = z.object({ messages: z.array(z.unknown()) }).passthrough();

/** a leading system message (openai dialect) we may merge into:
 *  string content joins (`stanza\n\nexisting`), part-array
 *  content gains a leading text part — one message, no duplicates */
const LeadingSystem = z
  .object({ role: z.literal("system"), content: z.union([z.string(), z.array(z.unknown())]) })
  .passthrough();

/** a top-level system (anthropic dialect): string or text blocks */
const TopSystem = z.union([z.string(), z.array(z.unknown())]);

/** a body that names a model (both dialects carry top-level `model`) */
const ModelBearer = z.object({ model: z.string().min(1) }).passthrough();

/** the SECOND sanctioned body rewrite — the LANE PIN: a /w/<slug>
 *  launch URL pins the model the ride uses (whatever the client's
 *  body says, the pin wins — one URL launches any executor on any
 *  model+hub, zero client config). A body naming no model rides
 *  untouched (the pipeline's own model check fails it honestly). */
export function pinnedBodyOf(raw: string, model: string): string {
  const json = parseJson(raw);
  if (!json.ok) return raw;
  const body = ModelBearer.safeParse(json.data);
  if (!body.success) return raw;
  body.data.model = model;
  return JSON.stringify(body.data);
}

function injectOpenai(
  messages: z.output<typeof InjectableChatBody>["messages"],
  stanza: string,
): void {
  const leading = LeadingSystem.safeParse(messages[0]);
  if (leading.success) {
    // safeParse yields a CLONE — merge into it, then put it back
    if (typeof leading.data.content === "string")
      leading.data.content = `${stanza}\n\n${leading.data.content}`;
    else leading.data.content = [{ type: "text", text: stanza }, ...leading.data.content];
    messages[0] = leading.data;
  } else {
    messages.unshift({ role: "system", content: stanza });
  }
}

function injectAnthropic(body: z.output<typeof InjectableChatBody>, stanza: string): void {
  const system = TopSystem.safeParse(body["system"]);
  if (!system.success) {
    body["system"] = stanza;
    return;
  }
  if (typeof system.data === "string") body["system"] = `${stanza}\n\n${system.data}`;
  else body["system"] = [{ type: "text", text: stanza }, ...system.data];
}

/** the ONE sanctioned body rewrite, dialect-aware (the proven W3081
 *  semantics): openai — a leading system message gets the stanza
 *  PREPENDED into it, absent one the stanza becomes the first
 *  system message; anthropic — the TOP-LEVEL system (string or
 *  block array) merges the same way, absent one becomes the stanza.
 *  A non-chat-shaped body is returned untouched — injection never
 *  corrupts what it does not understand. */
export function injectedBodyOf(raw: string, stanza: string, route: ChatRoute): string {
  const json = parseJson(raw);
  if (!json.ok) return raw;
  const body = InjectableChatBody.safeParse(json.data);
  if (!body.success) return raw;
  if (route === "chat") injectOpenai(body.data.messages, stanza);
  else injectAnthropic(body.data, stanza);
  return JSON.stringify(body.data);
}
