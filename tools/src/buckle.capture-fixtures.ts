// buckle.capture-fixtures.ts — refresh deploy/fixtures/*.models.json
// from the REAL provider catalogs (openrouter, github copilot, z.ai)
// with the fleet's own configured credentials. The stubs serve these
// files verbatim as /v1/models responses — the fixture IS a store of
// what the provider answered: the FULL set the account sees (no
// hand-picked ids, no slicing). The only filters are the providers'
// OWN flags (copilot's model_picker_enabled, previews excluded) —
// never our taste.
//
// Keys are MACHINE-LOCAL (never committed): env overrides or the
// default runtime home below. Run: bun tools/src/buckle.capture-fixtures.ts
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = process.env["FLEET_RUNTIME_HOME"] ?? join(homedir(), ".claude/local-llm");

/** filter modes: "all" = every row the account sees; "pickable" = the
 *  provider's own servable flag (copilot model_picker_enabled, previews
 *  excluded). No id lists — curation by taste is the bug this fixes. */
const RAW_SELECTION = {
  // the ACCOUNT list (models/user): every model our openrouter key
  // actually sees — hundreds of real rows, verbatim
  "openrouter.models.json": {
    url: "https://openrouter.ai/api/v1/models/user",
    key: "openrouter.key",
    filter: "all",
  },
  "mscopilot.models.json": {
    url: "https://api.githubcopilot.com/models",
    key: "copilot.key",
    headers: { "copilot-integration-id": "cockpit" },
    filter: "pickable",
  },
  "zai.models.json": {
    url: "https://api.z.ai/api/coding/paas/v4/models",
    key: "zai.key",
    filter: "all",
  },
};


import { z } from "zod";

// The schema is the CONTRACT CHECK only (each row must carry an id) —
// the rows WRITTEN are the verbatim source objects: zod's default
// strips unknown keys, so writing parse output would flatten the real
// provider rows (pricing, context_length, capabilities…) into id-only
// husks. Validate, then slice from the raw response.
const ListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      model_picker_enabled: z.boolean().optional(),
      preview: z.boolean().optional(),
    }).passthrough(),
  ),
});
type Row = z.output<(typeof ListSchema)["shape"]["data"]["element"]>;

/** "pickable" reads the PROVIDER's flags only — copilot marks its own
 *  servable set; everything else rides whole. */
function keepRow(m: Row, filter: Filter): boolean {
  if (filter === "all") return true;
  return m.model_picker_enabled === true && m.preview !== true;
}

const OUT = new URL("../../deploy/fixtures/", import.meta.url).pathname;

const CaptureSchema = z.object({
  url: z.string(),
  key: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  filter: z.enum(["all", "pickable"]),
});
type Capture = z.output<typeof CaptureSchema>;
type Filter = Capture["filter"];

const SELECTION: Record<string, Capture> = z
  .record(z.string(), CaptureSchema)
  .parse(RAW_SELECTION);

for (const [file, cfg] of Object.entries(SELECTION)) {
  const bearer = process.env[`${cfg.key.replace(".", "_").toUpperCase()}_PATH`] ??
    await Bun.file(join(HOME, cfg.key)).text();
  const r = await fetch(cfg.url, {
    headers: {
      authorization: `Bearer ${bearer.trim()}`,
      ...(("headers" in cfg ? cfg.headers : undefined) ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) {
    console.error(`${file}: ${cfg.url} → ${r.status}, SKIPPED (kept existing)`);
    continue;
  }
  const raw: unknown = await r.json();
  const rows: Row[] = ListSchema.parse(raw).data.filter((m) =>
    keepRow(m, cfg.filter),
  );
  if (rows.length === 0) {
    console.error(`${file}: no rows survived the filter, SKIPPED`);
    continue;
  }
  writeFileSync(
    join(OUT, file),
    `${JSON.stringify({ object: "list", data: rows }, null, 2)}\n`,
  );
  console.log(`${file}: ${rows.length} real rows stored (${cfg.filter})`);
}
