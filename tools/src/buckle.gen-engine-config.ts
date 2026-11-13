// buckle.gen-engine-config.ts — generate the litellm engine configs
// FROM the real captured catalogs (test/deploy/fixtures/*.models.json):
// every catalog row becomes a deployment under its REAL id, mapped to
// an openai-compatible leg at the stub base. The engine therefore
// serves exactly the ids the stub catalog advertises — catalog and
// deployment can never drift, and no model id is ever hand-typed.
//
// Output: deploy/engine/<provider>.litellm.yaml (generated, gitignored).
// Run: bun tools/src/buckle.gen-engine-config.ts (also run by the
// playwright global-setup before the stack boots).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

const FixtureSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});
type Fixture = z.output<typeof FixtureSchema>;

/** provider fixture → the stub api_base its engine legs point at */
const UNITS = {
  openrouter: "http://openrouter-stub:8080/v1",
  mscopilot: "http://mscopilot-stub:8080/v1",
  zai: "http://zai-stub:8080/v1",
} as const;

const ROOT = new URL("../..", import.meta.url).pathname;
const OUT = join(ROOT, "test", "deploy", "engine");

function deploymentsOf(provider: keyof typeof UNITS): string {
  const fixture: Fixture = FixtureSchema.parse(
    JSON.parse(
      readFileSync(
        join(ROOT, "test", "deploy", "fixtures", `${provider}.models.json`),
        "utf8",
      ),
    ),
  );
  const lines = ["model_list:"];
  for (const row of fixture.data) {
    lines.push(
      `  - model_name: ${JSON.stringify(row.id)}`,
      "    litellm_params:",
      // the REAL catalog id served as-is; the leg rides the
      // openai-compatible stub (test fixture key, not a secret)
      `      model: ${JSON.stringify(`openai/${row.id.replace(/^openai\//, "")}`)}`,
      `      api_base: ${JSON.stringify(UNITS[provider])}`,
      '      api_key: "sk-stub-fixture"',
    );
  }
  return [
    `# GENERATED from deploy/fixtures/${provider}.models.json (the real`,
    "# captured catalog) — never hand-edited; regenerate instead.",
    ...lines,
    "",
  ].join("\n");
}

export function genEngineConfigs(): void {
  mkdirSync(OUT, { recursive: true });
  for (const provider of Object.keys(UNITS) as (keyof typeof UNITS)[]) {
    writeFileSync(
      join(OUT, `${provider}.litellm.yaml`),
      deploymentsOf(provider),
    );
    console.log(`test/deploy/engine/${provider}.litellm.yaml written`);
  }
}

if (import.meta.main) genEngineConfigs();
