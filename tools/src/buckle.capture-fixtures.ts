// buckle.capture-fixtures.ts — refresh deploy/fixtures/*.models.json
// from the REAL provider catalogs (openrouter, github copilot, z.ai).
// The stubs serve these files verbatim as /v1/models responses — so
// the demo catalog is what the providers actually answer today, real
// row objects and all, never hand-typed fiction.
//
// Keys are MACHINE-LOCAL (never committed): env overrides or the
// default runtime home below. Run: bun tools/src/buckle.capture-fixtures.ts
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = process.env["FLEET_RUNTIME_HOME"] ?? join(homedir(), ".claude/local-llm");

/** the demo rides two REAL rows per provider — the first is the chat model */
const RAW_SELECTION = {
  "openrouter.models.json": {
    url: "https://openrouter.ai/api/v1/models",
    key: "openrouter.key",
    pick: ["qwen/qwen3.8-max-prime", "qwen/qwen3.8-flash"],
  },
  "mscopilot.models.json": {
    url: "https://api.githubcopilot.com/models",
    key: "copilot.key",
    headers: { "copilot-integration-id": "cockpit" },
    pick: ["gpt-6-astra", "gpt-5.3-codex"],
  },
  "zai.models.json": {
    url: "https://api.z.ai/api/coding/paas/v4/models",
    key: "zai.key",
    pick: ["glm-5.3", "glm-5.3-flash"],
  },
};


import { z } from "zod";

const ListSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
});
type List = z.output<typeof ListSchema>;

const OUT = new URL("../../deploy/fixtures/", import.meta.url).pathname;

const CaptureSchema = z.object({
  url: z.string(),
  key: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  pick: z.array(z.string()),
});
type Capture = z.output<typeof CaptureSchema>;

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
  const list = ListSchema.parse(await r.json());
  const rows = list.data.filter((m) => cfg.pick.includes(m.id));
  if (rows.length !== cfg.pick.length) {
    console.error(`${file}: only ${rows.length}/${cfg.pick.length} ids found, SKIPPED`);
    continue;
  }
  writeFileSync(
    join(OUT, file),
    `${JSON.stringify({ object: "list", data: rows }, null, 2)}\n`,
  );
  console.log(`${file}: ${rows.length} real rows (${cfg.pick.join(", ")})`);
}
