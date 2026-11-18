// buckle.gen-engine-config.ts — generate the litellm engine configs
// so catalog and deployment can never drift, and no model id is ever
// hand-typed. TWO modes:
//
//   stub (default): every row of the captured catalog
//     (test/deploy/fixtures/<provider>.models.json) becomes a
//     deployment under its REAL id mapped to an openai-compatible leg
//     at the stub base. Output test/deploy/engine/<p>.litellm.yaml
//     (generated, gitignored; the Playwright stack-setup project runs this).
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

/** BYOC seats ride the engine's PASS-THROUGH seam (verified live on
 *  litellm 1.103.0): `include_subpath: true` + `forward_headers:
 *  true` relays the CALLER's Authorization verbatim to the seat —
 *  model deployments CANNOT carry it (a deployment api_key replaces
 *  the user credential; keyless ones 500 on client construction).
 *  The path convention is the contract buckle's userleg rides:
 *  /v1/byoc/<label>/<subpath>. */
function byocPassThroughOf(label: KnownProviderLabel, target: string): string {
  const known: KnownProvider = KNOWN_PROVIDERS[label];
  const headers = Object.entries(known.catalog_headers)
    .map(([k, v]) => `        ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join("\n");
  const row = (path: string, rowTarget: string, subpath: boolean) =>
    `    - path: ${JSON.stringify(path)}\n` +
    `      target: ${JSON.stringify(rowTarget)}\n` +
    (subpath ? "      include_subpath: true\n" : "") +
    "      forward_headers: true\n" +
    (headers.length > 0 ? `      headers:\n${headers}\n` : "");
  // ORDER IS LOAD-BEARING: litellm matches the first row whose path
  // prefixes the request — explicit seat-route rows MUST precede the
  // catch-all, or the uniform join lands chat on the seat's Go-404
  const routeRows = Object.entries(known.byoc_routes ?? {})
    .map(([wire, seat]) => row(`/v1/byoc/${label}${wire}`, `${target}${seat}`, false))
    .join("");
  return (
    header([
      `GENERATED for the BYOC seat ${label} — never hand-edited.`,
      "Pass-through seam: the caller's token IS the credential — litellm",
      "forwards the incoming Authorization verbatim (forward_headers),",
      "registry catalog_headers ride static config. Buckle's userleg",
      "calls /v1/byoc/" + label + "/<subpath>. Seat route rows come",
      "first (byoc_routes in the registry — the live seat is not",
      "path-uniform); the catch-all forwards everything else verbatim.",
    ]) +
    "general_settings:\n" +
    "  pass_through_endpoints:\n" +
    routeRows +
    row(`/v1/byoc/${label}`, target, true)
  );
}

const ROOT = new URL("../..", import.meta.url).pathname;
const OUT = join(ROOT, "test", "deploy", "engine");

function header(comment: string[]): string {
  return comment.map((l) => `# ${l}`).join("\n") + "\n";
}

function stubDeploymentsOf(provider: keyof typeof UNITS): string {
  // BYOC seat: the PASS-THROUGH seam always rides (auth cannot ride
  // model deployments). The stub file ALSO carries the classic keyed
  // deployments — the settings layer can declare the seat ENGINE-HELD
  // (b2 does; its key file is a stub fixture, not a user token), and
  // that world rides /v1/chat/completions against model_list rows.
  const passThrough = KNOWN_PROVIDERS[provider].user_token
    ? byocPassThroughOf(provider, UNITS[provider].replace(/\/v1$/, ""))
    : "";
  const fixture: Fixture = FixtureSchema.parse(
    JSON.parse(
      readFileSync(join(ROOT, "test", "deploy", "fixtures", `${provider}.models.json`), "utf8"),
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
  const deployments = [
    header([
      `GENERATED from test/deploy/fixtures/${provider}.models.json`,
      "(the real captured catalog) — never hand-edited; regenerate instead.",
    ]),
    ...lines,
    "",
  ].join("\n");
  return `${passThrough}${deployments}`;
}

/** a REAL leg per row: dialect decides the shape (one registry,
 *  one truth). Keys ride os.environ — never the generated file.
 *  BYOC seats never reach here — their files are the pass-through
 *  seam (the caller's token cannot ride a deployment). */
function realLegOf(known: KnownProvider, id: string): string[] {
  const litellm_params: string[] = [];
  if (known.dialect === "openai") {
    litellm_params.push(
      `      model: ${JSON.stringify(`openai/${id.replace(/^openai\//, "")}`)}`,
      `      api_base: ${JSON.stringify(known.url)}`,
      `      api_key: ${JSON.stringify(`os.environ/${known.key_env}`)}`,
    );
  } else if (known.dialect === "github_copilot") {
    litellm_params.push(
      `      model: ${JSON.stringify(`github_copilot/${id}`)}`,
      `      api_key: ${JSON.stringify(`os.environ/${known.key_env}`)}`,
    );
  } else {
    litellm_params.push(
      `      model: ${JSON.stringify(`anthropic/${id}`)}`,
      `      api_key: ${JSON.stringify(`os.environ/${known.key_env}`)}`,
    );
  }
  litellm_params.push("    model_info:", "      disable_background_health_check: true");
  return litellm_params;
}

async function pullCatalog(
  label: KnownProviderLabel,
): Promise<{ label: KnownProviderLabel; rows: string[] }> {
  const known = KNOWN_PROVIDERS[label];
  const keyPath =
    process.env[`${label.toUpperCase()}_KEY_PATH`] ?? known.key_file.replace("~", homedir());
  const key = (await Bun.file(keyPath).text()).trim();
  const r = await fetch(`${known.url}/models`, {
    headers: { authorization: `Bearer ${key}`, ...known.catalog_headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`${label}: catalog pull ${r.status} from ${known.url}/models`);
  const catalog = FixtureSchema.parse(await r.json());
  // the provider's OWN order; take keeps engine boot bounded (BYOC
  // seats take the FULL list — the catalog rides verbatim)
  const cap = "take" in known ? known.take : undefined;
  const rows = catalog.data.map((row) => row.id).slice(0, cap ?? Infinity);
  return { label, rows };
}

/** PURE renderer: catalog ids -> the real engine yaml. The ONLY place
 *  engine rows are produced (live pull and fixture round-trip share it). */
export function renderRealConfig(
  label: KnownProviderLabel,
  rows: string[],
  at: string,
  passThrough = "",
): string {
  const known = KNOWN_PROVIDERS[label];
  const lines = ["model_list:"];
  for (const id of rows) {
    lines.push(
      `  - model_name: ${JSON.stringify(id)}`,
      "    litellm_params:",
      ...realLegOf(known, id),
    );
  }
  return (
    header([
      `GENERATED from the LIVE ${label} catalog (${known.url}/models)`,
      `at ${at} — never hand-edited.`,
      `Keys ride os.environ/${known.key_env} (never this file).`,
    ]) +
    lines.join("\n") +
    "\nlitellm_settings:\n  drop_params: true # tolerate wire params the seat 400s on\n" +
    // the engine gate: only a buckle holding keys/engine reaches the legs
    "\ngeneral_settings:\n  master_key: os.environ/ENGINE_MASTER_KEY\n" +
    (passThrough !== "" ? "  pass_through_endpoints:\n" + passThrough : "")
  );
}

export async function genRealEngineConfigs(outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  // REAL_PROVIDERS filters the loop (wiring, not hand-authored
  // files — a hub generating only its seat needs no other key)
  const filter = process.env["REAL_PROVIDERS"]?.split(",").map((s) => s.trim());
  // ENGINE_HELD_SEATS: user_token seats the HUB holds a credential
  // for (W2595: the azure VMSS fronts the IKEA MS Copilot seat — the
  // hub's own PAT rides os.environ, github_copilot/ legs serve the
  // FULL catalog as chat-completions deployments, and the pass-through
  // seam stays for per-dev BYOC callers). Both worlds in one file.
  const engineHeld =
    process.env["ENGINE_HELD_SEATS"]?.split(",").map((s) => s.trim()) ?? [];
  for (const label of Object.keys(KNOWN_PROVIDERS) as KnownProviderLabel[]) {
    if (filter !== undefined && !filter.includes(label)) continue;
    const known = KNOWN_PROVIDERS[label];
    // BYOC seat NOT held by the hub: the pass-through seam only
    if (known.user_token && !engineHeld.includes(label)) {
      writeFileSync(join(outDir, `${label}.litellm.yaml`), byocPassThroughOf(label, known.url));
      console.log(`${outDir}/${label}.litellm.yaml: BYOC pass-through (caller token forwards)`);
      continue;
    }
    const passThrough =
      known.user_token && engineHeld.includes(label)
        ? byocPassThroughOf(label, known.url).replace(
            "general_settings:\n  pass_through_endpoints:\n",
            "",
          )
        : "";
    const { rows } = await pullCatalog(label);
    if (rows.length === 0)
      throw new Error(`${label}: live catalog empty — refusing to emit an empty engine`);
    writeFileSync(
      join(outDir, `${label}.litellm.yaml`),
      renderRealConfig(label, rows, new Date().toISOString(), passThrough),
    );
    console.log(
      `${outDir}/${label}.litellm.yaml: ${rows.length} real legs (${known.dialect})${passThrough !== "" ? " + BYOC pass-through" : ""}`,
    );
  }
}

export function genEngineConfigs(): void {
  mkdirSync(OUT, { recursive: true });
  for (const provider of Object.keys(UNITS) as (keyof typeof UNITS)[]) {
    writeFileSync(join(OUT, `${provider}.litellm.yaml`), stubDeploymentsOf(provider));
    console.log(`test/deploy/engine/${provider}.litellm.yaml written`);
  }
}

if (import.meta.main) {
  const out = process.argv.includes("--real")
    ? (process.env["REAL_OUT"] ?? join(homedir(), ".config", "fleet-buckle", "engine"))
    : undefined;
  if (out === undefined) genEngineConfigs();
  else await genRealEngineConfigs(out);
}
