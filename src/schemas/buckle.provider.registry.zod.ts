// buckle.provider.registry.zod.ts — the RECOGNIZED providers: real
// default endpoints, dialects, and how each catalog is pulled. A
// settings provider entry may omit `url`/`dialect` — the registry
// default applies; an UNKNOWN label without an explicit url fails
// loud at parse. Engine legs read the same registry (dialect decides
// the litellm leg shape; key_env names the engine-container env var).
// Key FILES are muramasa runtime paths (never values in this repo).
import { z } from "zod";

/** the wire dialects the recognized providers speak — ONE home; the
 *  settings provider rows and the engine-leg generator compose this
 *  enum (never a re-declared mirror) */
export const ProviderDialect = z.enum(["openai", "anthropic", "github_copilot"]);
export type ProviderDialect = z.output<typeof ProviderDialect>;

export const KnownProviderSchema = z.object({
  /** the API root: catalogs at {url}/models, openai legs at {url}/chat/completions */
  url: z.string().url(),
  dialect: ProviderDialect,
  /** headers every catalog pull carries (the copilot seat demands its integration id) */
  catalog_headers: z.record(z.string(), z.string()),
  /** engine-gen cap on rows per provider (registry-declared, operator-editable) */
  take: z.number().int().positive().optional(),
  /** the env var the engine container reads the key from */
  key_env: z.string(),
  /** muramasa default key file (tilde-expanded by the launcher, env-overridable) */
  key_file: z.string(),
  /** BYOC default: when true, this seat rides the CALLER's /w/ token
   *  upstream — no unit-level key file ever exists for it (the
   *  Copilot seat: every dev forwards their own token) */
  user_token: z.boolean().optional(),
  /** BYOC seat route table (LIVE-verified 2026-11-15 on the Copilot
   *  seat): buckle's wire path → the seat's real path. The seat is
   *  NOT uniform (chat is BARE /chat/completions, anthropic keeps
   *  /v1/messages, the responses family is BARE /responses) — the
   *  uniform include_subpath join lands chat on a Go-404. The
   *  generator emits one explicit passthrough row per entry; only
   *  user_token seats may carry the field */
  byoc_routes: z.record(z.string(), z.string()).optional(),
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
    user_token: false,
  },
  mscopilot: {
    url: "https://api.githubcopilot.com",
    dialect: "github_copilot",
    catalog_headers: { "copilot-integration-id": "vscode-chat" },
    key_env: "COPILOT_API_KEY",
    key_file: "~/.claude/local-llm/copilot.key",
    user_token: true, // per-dev tokens ride /w/<lane>/<token>/… — never stored
    byoc_routes: {
      "/v1/chat/completions": "/chat/completions",
      "/v1/messages": "/v1/messages",
      "/v1/responses": "/responses",
    },
  },
  zai: {
    url: "https://api.z.ai/api/coding/paas/v4",
    dialect: "openai",
    catalog_headers: {},
    key_env: "ZAI_API_KEY",
    key_file: "~/.claude/local-llm/zai.key",
    take: 12, // the coding plan's full list
    user_token: false,
  },
} as const satisfies Record<string, KnownProvider>;

export type KnownProviderLabel = keyof typeof KNOWN_PROVIDERS;
