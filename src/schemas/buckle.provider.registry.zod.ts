// buckle.provider.registry.zod.ts — the RECOGNIZED providers: real
// default endpoints, dialects, and how each catalog is pulled. A
// settings provider entry may omit `url`/`dialect` — the registry
// default applies; an UNKNOWN label without an explicit url fails
// loud at parse. Engine legs read the same registry (dialect decides
// the litellm leg shape; key_env names the engine-container env var).
// Key FILES are muramasa runtime paths (never values in this repo).
import { z } from "zod";

export const KnownProviderSchema = z.object({
  /** the API root: catalogs at {url}/models, openai legs at {url}/chat/completions */
  url: z.string().url(),
  dialect: z.enum(["openai", "anthropic", "github_copilot"]),
  /** headers every catalog pull carries (the copilot seat demands its integration id) */
  catalog_headers: z.record(z.string(), z.string()),
  /** engine-gen cap on rows per provider (registry-declared, operator-editable) */
  take: z.number().int().positive().optional(),
  /** the env var the engine container reads the key from */
  key_env: z.string(),
  /** muramasa default key file (tilde-expanded by the launcher, env-overridable) */
  key_file: z.string(),
});
export type KnownProvider = z.output<typeof KnownProviderSchema>;

export const KNOWN_PROVIDERS = {
  openrouter: {
    url: "https://openrouter.ai/api/v1",
    dialect: "openai",
    catalog_headers: {},
    take: 40,
    key_env: "OPENROUTER_API_KEY",
    key_file: "~/.claude/local-llm/openrouter.key",
  },
  mscopilot: {
    url: "https://api.githubcopilot.com",
    dialect: "github_copilot",
    catalog_headers: { "copilot-integration-id": "vscode-chat" },
    key_env: "COPILOT_API_KEY",
    key_file: "~/.claude/local-llm/copilot.key",
    take: 42, // the seat's full list
  },
  zai: {
    url: "https://api.z.ai/api/coding/paas/v4",
    dialect: "openai",
    catalog_headers: {},
    key_env: "ZAI_API_KEY",
    key_file: "~/.claude/local-llm/zai.key",
    take: 12, // the coding plan's full list
  },
} as const satisfies Record<string, KnownProvider>;

export type KnownProviderLabel = keyof typeof KNOWN_PROVIDERS;

/** the catalog FACE every provider serves: {data: [{id, …}]} — the
 *  single shape for the server pull, the engine gen, and captures */
export const ProviderCatalogSchema = z.object({
  data: z.array(z.object({ id: z.string() }).passthrough()),
});
export type ProviderCatalog = z.output<typeof ProviderCatalogSchema>;
