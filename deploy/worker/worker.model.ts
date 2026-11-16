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
// ENGINE MODE (owner ruling 2026-11-16): when a .prefer file picked a
// model, asks ride <hub>/v1/chat/completions DIRECTLY with the picked
// body model (the engine serves the seat SKUs; lane pinning retired).
import { z } from "zod";
import { env } from "./worker.env.ts";
import type { Pick } from "./worker.prefer.ts";

let pick: Pick | undefined;
// the seed dir persona chain (baked into the image; mounts overwrite):
// persona.md (character) THEN template.md (the incoming brief) are
// prepended to every ask, before the task instruction — the
// pi-durable instructions pattern as mounted files.
let personaText = "";
let templateText = "";

/** stamp the boot-time .prefer pick (worker.main.ts); asks use it after */
export const setPick = (p: Pick): void => {
  pick = p;
};

/** stamp the seed dir's persona.md character (worker.main.ts) */
export const setPersona = (t: string): void => {
  personaText = t.trim();
};

/** stamp the seed dir's template.md incoming brief (worker.main.ts) */
export const setTemplate = (t: string): void => {
  templateText = t.trim();
};

/**
 * The seed files' VARIABLE EXPANSION — the pi-durable port. There,
 * prompt state is sections: `section(key, (input) => text)` where
 * the render runs AT REQUEST PREPARATION over the live input
 * (conversation, agent, env, committed doc reads) — no string
 * template engine exists in the library. The faithful equivalent
 * for file-based seeds: render at ASK time (not boot, so the picked
 * model lands in the prompt) over the worker's live facts. Unknown
 * tokens pass through verbatim — a section returning undefined just
 * omits; we degrade to the literal instead.
 */
const expandSeed = (text: string, vars: Readonly<Record<string, string>>): string =>
  text.replace(/\{\{(\w+)\}\}/g, (whole, token: string) => vars[token] ?? whole);

/** the live render input for one ask — pi-durable's PromptInput shape */
const seedVars = (): Readonly<Record<string, string>> => ({
  repo: env.repo,
  lane: env.lane,
  hub: pick?.hub ?? env.buckle,
  hubLabel: pick?.hubLabel ?? "env",
  provider: pick?.provider ?? "-",
  model: pick?.model ?? "lane-pinned",
  tier: pick?.tier ?? "lane",
  tag: pick?.tag ?? "-",
  color: pick?.color ?? "-",
  issuePrefix: env.issuePrefix,
});

export async function ask<T>(
  schema: z.ZodType<T>,
  instruction: string,
  context: string,
  example: object,
): Promise<T> {
  const vars = seedVars();
  const persona = personaText ? `${expandSeed(personaText, vars)}\n\n` : "";
  const template = templateText ? `${expandSeed(templateText, vars)}\n\n` : "";
  const body = {
    // pin-proof: the body model DIFFERS from the lane pin — a stub
    // /_seen model equal to the PIN proves the pin won, not the body.
    // Engine mode overrides: the body model IS the picked seat SKU.
    model: pick?.model ?? "glm-4.5",
    ...(pick && pick.maxTokens > 0 ? { max_tokens: pick.maxTokens } : {}),
    messages: [
      {
        role: "user",
        content:
          `${persona}${template}${instruction}\n\nReply with STRICT JSON only, no prose, no code fence, matching this shape:\n${JSON.stringify(z.toJSONSchema(schema))}\nExample reply — same structure, but choose the CORRECT values for this input:\n${JSON.stringify(example)}\n\n---\n${context}`,
      },
    ],
  };
  const r = await fetch(
    env.byoc
      ? `${env.buckle}/w/${env.lane}/${env.buckleKey}/v1/chat/completions`
      : pick
        ? `${pick.hub}/v1/chat/completions`
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
