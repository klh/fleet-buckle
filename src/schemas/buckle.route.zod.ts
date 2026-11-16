// buckle.route.zod.ts — the THREE wire dialects buckle speaks at its
// OWN faces ("chat" = /v1/chat/completions, "messages" = /v1/messages,
// "responses" = /v1/responses — the OpenAI Responses wire); everything
// else passes through verbatim — litellm owns every other
// wire. ONE home for the enum the judge facts, the pipeline stamp, and
// the settings context rules all compose (never a re-declared mirror).
import { z } from "zod";

export const ChatRouteSchema = z.enum(["chat", "messages", "responses"]);
export type ChatRoute = z.output<typeof ChatRouteSchema>;
