// Offline deployment boundary, not a gateway catalog filter. LiteLLM owns
// the full config; preserve fields unknown to Buckle when removing a row.
import { z } from "zod";

const EngineConfig = z.looseObject({
  model_list: z.array(z.looseObject({
    model_name: z.string().min(1),
    litellm_params: z.record(z.string(), z.unknown()),
  })).min(1),
});

export const BuckleEngineDemotion = z.object({
  engine: EngineConfig,
  model: z.string().min(1),
}).transform(({ engine, model }, ctx) => {
  const remaining = engine.model_list.filter((row) => row.model_name !== model);
  const removed = engine.model_list.length - remaining.length;
  if (removed === 0 || remaining.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: removed === 0 ? "model is not configured" : "refusing to empty the engine catalog",
    });
    return z.NEVER;
  }
  return { engine: { ...engine, model_list: remaining }, removed };
}).pipe(z.object({ engine: EngineConfig, removed: z.number().int().positive() }));
