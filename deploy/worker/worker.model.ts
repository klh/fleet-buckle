// worker.model.ts — the LLM leg compartment: every model ask rides
// the buckle launch lane (the LANE pins the model — the body model is
// a pin-PROOF, deliberately different from the pin so stub /_seen
// evidence proves the pin won). TWO auth topologies, one knob:
//   WORKER_BYOC=true  → /w/<lane>/<token>/v1/chat/completions, the
//                       caller's seat credential forwards verbatim
//                       (live-proven on the azure hub: header → 401
//                       "a principal key is required", URL → 200)
//   WORKER_BYOC=false → /w/<lane>/v1/chat/completions + Bearer
//                       principal key; the provider key rides upstream
//                       (the hermetic rig's dave@fleet world).
// The durable rework keeps the seam; asks become generation tasks.
import { z } from "zod";
import { env } from "./worker.env.ts";

export async function ask<T>(
  schema: z.ZodType<T>,
  instruction: string,
  context: string,
  example: object,
): Promise<T> {
  const body = {
    // pin-proof: the body model DIFFERS from the lane pin — a stub
    // /_seen model equal to the PIN proves the pin won, not the body
    model: "glm-4.5",
    messages: [
      {
        role: "user",
        content:
          `${instruction}\n\nReply with STRICT JSON only, no prose, no code fence, matching this shape:\n${JSON.stringify(z.toJSONSchema(schema))}\nExample reply — same structure, but choose the CORRECT values for this input:\n${JSON.stringify(example)}\n\n---\n${context}`,
      },
    ],
  };
  const r = await fetch(
    env.byoc
      ? `${env.buckle}/w/${env.lane}/${env.buckleKey}/v1/chat/completions`
      : `${env.buckle}/w/${env.lane}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(!env.byoc && { authorization: `Bearer ${env.buckleKey}` }),
      },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error(`buckle chat: ${r.status} ${await r.text()}`);
  const chat = z
    .object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })) })
    .passthrough()
    .parse(await r.json());
  const text = chat.choices[0]?.message?.content ?? "";
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart < 0 || jsonEnd < jsonStart)
    throw new Error(`llm contract: no JSON object in reply: ${text.slice(0, 120)}`);
  const parsed = schema.safeParse(JSON.parse(text.slice(jsonStart, jsonEnd + 1)));
  if (!parsed.success)
    throw new Error(`llm contract: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
  return parsed.data;
}
