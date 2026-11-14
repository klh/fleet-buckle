// buckle.gen-engine-config.ts — generate the litellm engine configs
// so catalog and deployment can never drift, and no model id is ever
// hand-typed. TWO modes:
//
//   stub (default): every row of the captured catalog
//     (test/deploy/fixtures/<provider>.models.json) becomes a
//     deployment under its REAL id mapped to an openai-compatible leg
//     at the stub base. Output test/deploy/engine/<p>.litellm.yaml
//     (generated, gitignored; the playwright global-setup runs this).
//
//   --real: every row of the LIVE catalog (pulled from the registry
//     endpoint with the muramasa key) becomes a deployment mapped to
//     a REAL leg — dialect decides the leg shape (openai legs carry
//     the api_base; github_copilot legs ride the PAT). Keys NEVER
//     ride the yaml: `os.environ/<KEY_ENV>` names the engine
//     container's env var. Output goes to the real runtime home.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  KNOWN_PROVIDERS,
  type KnownProvider,
  type KnownProviderLabel,
} from "../../src/schemas/buckle.provider.registry.zod.ts";

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

function header(comment: string[]): string {
  return comment.map((l) => `# ${l}`).join("\n") + "\n";
}

function stubDeploymentsOf(provider: keyof typeof UNITS): string {
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
    header([
      "GENERATED from test/deploy/fixtures/" + provider + ".models.json",
      "(the real captured catalog) — never hand-edited; regenerate instead.",
    ]),
    ...lines,
    "",
  ].join("\n");
}

/** a REAL leg per row: dialect decides the shape (one registry, one
 *  truth). Keys ride os.environ — never the generated file. */
function realLegOf(known: KnownProvider, id: string): string[] {
  const litellm_params: string[] = [];
  if (known.dialect === "openai") {
    litellm_params.push(
      `      model: ${JSON.stringify(`openai/${id.replace(/^openai\//, "")}`)}`,
      `      api_base: ${JSON.stringify(known.url)}`,
    );
  } else if (known.dialect === "github_copilot") {
    litellm_params.push(`      model: ${JSON.stringify(`github_copilot/${id}`)}`);
  } else {
    litellm_params.push(`      model: ${JSON.stringify(`anthropic/${id}`)}`);
  }
  litellm_params.push(
    `      api_key: ${JSON.stringify(`os.environ/${known.key_env}`)}`,
    "    model_info:",
    "      disable_background_health_check: true",
  );
  return litellm_params;
}

async function pullCatalog(
  label: KnownProviderLabel,
): Promise<{ label: KnownProviderLabel; rows: string[] }> {
  const known = KNOWN_PROVIDERS[label];
  const keyPath =
    process.env[`${label.toUpperCase()}_KEY_PATH`] ??
    known.key_file.replace("~", homedir());
  const key = (await Bun.file(keyPath).text()).trim();
  const r = await fetch(`${known.url}/models`, {
    headers: { authorization: `Bearer ${key}`, ...known.catalog_headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`${label}: catalog pull ${r.status} from ${known.url}/models`);
  const catalog = FixtureSchema.parse(await r.json());
  // the provider's OWN order; take keeps engine boot bounded
  const rows = catalog.data.map((row) => row.id).slice(0, known.take ?? Infinity);
  return { label, rows };
}

export async function genRealEngineConfigs(outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  for (const label of Object.keys(KNOWN_PROVIDERS) as KnownProviderLabel[]) {
    const known = KNOWN_PROVIDERS[label];
    const { rows } = await pullCatalog(label);
    if (rows.length === 0) throw new Error(`${label}: live catalog empty — refusing to emit an empty engine`);
    const lines = ["model_list:"];
    for (const id of rows) {
      lines.push(
        `  - model_name: ${JSON.stringify(id)}`,
        "    litellm_params:",
        ...realLegOf(known, id),
      );
    }
    writeFileSync(
      join(outDir, `${label}.litellm.yaml`),
      header([
        `GENERATED from the LIVE ${label} catalog (${known.url}/models)`,
        `at ${new Date().toISOString()} — never hand-edited.`,
        `Keys ride os.environ/${known.key_env} (never this file).`,
      ]) +
      lines.join("\n") +
      "\nlitellm_settings:\n  drop_params: true # tolerate Anthropic-only params the wires 400 on\n",
    );
    console.log(`${outDir}/${label}.litellm.yaml: ${rows.length} real legs (${known.dialect})`);
  }
}

export function genEngineConfigs(): void {
  mkdirSync(OUT, { recursive: true });
  for (const provider of Object.keys(UNITS) as (keyof typeof UNITS)[]) {
    writeFileSync(
      join(OUT, `${provider}.litellm.yaml`),
      stubDeploymentsOf(provider),
    );
    console.log(`test/deploy/engine/${provider}.litellm.yaml written`);
  }
}

if (import.meta.main) {
  const out = process.argv.includes("--real")
    ? process.env["REAL_OUT"] ??
      join(homedir(), ".config", "fleet-buckle", "engine")
    : undefined;
  if (out === undefined) genEngineConfigs();
  else await genRealEngineConfigs(out);
}
