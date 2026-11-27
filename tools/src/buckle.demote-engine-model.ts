// Generate a candidate from the EFFECTIVE engine artifact. No live mutation,
// no gateway filtering, no copied Belt implementation, no YAML config authored.
import { readFileSync, writeFileSync } from "node:fs";
import { attempt } from "../../src/fault.ts";
import { BuckleEngineDemotion } from "../../src/schemas/buckle.engine-demotion.zod.ts";

const [input, output, model, ...extra] = process.argv.slice(2);
if (input === undefined || output === undefined || model === undefined || extra.length > 0) {
  console.error("Usage: bun tools/src/buckle.demote-engine-model.ts <input.yaml> <new-output.yaml> <model>");
  process.exit(1);
}
attempt(() => {
  const result = BuckleEngineDemotion.safeParse({
    engine: Bun.YAML.parse(readFileSync(input, "utf8")),
    model,
  });
  if (!result.success) {
    console.error("Refusing demotion: engine config invalid, model absent, or no other routes remain.");
    process.exit(1);
  }
  // Exclusive creation also rejects an input/output alias (including symlinks).
  // Off-repo legacy config may contain values, so never print the candidate.
  writeFileSync(output, `# GENERATED: offline engine row demotion; review before rollout.\n${Bun.YAML.stringify(result.data.engine)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify({ removed: result.data.removed, remaining: result.data.engine.model_list.length }));
}, () => {
  // Parser/IO details may contain legacy key values or private paths.
  console.error("Refusing demotion: unreadable/invalid input or candidate could not be exclusively created.");
  process.exit(1);
});
