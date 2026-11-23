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
import {
  KNOWN_PROVIDERS,
  type KnownProviderLabel,
} from "../../src/schemas/buckle.provider.registry.zod.ts";

/** registry key_file is `~/...` — tilde expands to the REAL home
 *  (os.homedir), never the runtime dir; FLEET_RUNTIME_HOME only
 *  relocates the runtime itself */
const expandTilde = (p: string): string => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

/** capture-specific bits ONLY — url/headers/key file come from the
 *  provider registry (one home). path = the catalog endpoint variant
 *  (openrouter's /models/user is the ACCOUNT list); filter modes:
 *  "all" = every row the account sees, "pickable" = the provider's
 *  own servable flag (copilot model_picker_enabled, previews
 *  excluded). No id lists — curation by taste is the bug this fixes. */
const RAW_SELECTION: Record<KnownProviderLabel, { path: string; filter: "all" | "pickable" }> = {
  openai: { path: "/models", filter: "all" },
  openrouter: { path: "/models/user", filter: "all" },
  mscopilot: { path: "/models", filter: "pickable" },
  zai: { path: "/models", filter: "all" },
};

const OUT_FILE: Record<KnownProviderLabel, string> = {
  openai: "openai.models.json",
  openrouter: "openrouter.models.json",
  mscopilot: "mscopilot.models.json",
  zai: "zai.models.json",
};

import { z } from "zod";

// The schema is the CONTRACT CHECK only (each row must carry an id) —
// the rows WRITTEN are the verbatim source objects: zod's default
// strips unknown keys, so writing parse output would flatten the real
// provider rows (pricing, context_length, capabilities…) into id-only
// husks. Validate, then slice from the raw response.
const ListSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        model_picker_enabled: z.boolean().optional(),
        preview: z.boolean().optional(),
      })
      .passthrough(),
  ),
});
type Row = z.output<(typeof ListSchema)["shape"]["data"]["element"]>;

/** "pickable" reads the PROVIDER's flags only — copilot marks its own
 *  servable set; everything else rides whole. */
function keepRow(m: Row, filter: "all" | "pickable"): boolean {
  if (filter === "all") return true;
  return m.model_picker_enabled === true && m.preview !== true;
}

const OUT = new URL("../../../test/deploy/fixtures/", import.meta.url).pathname;

for (const [label, cfg] of Object.entries(RAW_SELECTION)) {
  const known = KNOWN_PROVIDERS[label as KnownProviderLabel];
  const file = OUT_FILE[label as KnownProviderLabel];
  const bearer =
    process.env[`${label.toUpperCase()}_KEY_PATH`] ??
    (await Bun.file(expandTilde(known.key_file)).text());
  const r = await fetch(`${known.url}${cfg.path}`, {
    headers: {
      authorization: `Bearer ${bearer.trim()}`,
      ...known.catalog_headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) {
    console.error(`${file}: ${known.url}${cfg.path} → ${r.status}, SKIPPED (kept existing)`);
    continue;
  }
  const raw: unknown = await r.json();
  const rows: Row[] = ListSchema.parse(raw).data.filter((m) => keepRow(m, cfg.filter));
  if (rows.length === 0) {
    console.error(`${file}: no rows survived the filter, SKIPPED`);
    continue;
  }
  writeFileSync(join(OUT, file), `${JSON.stringify({ object: "list", data: rows }, null, 2)}\n`);
  console.log(`${file}: ${rows.length} real rows stored (${cfg.filter})`);
}
