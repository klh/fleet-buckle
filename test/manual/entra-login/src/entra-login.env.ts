import type { Config } from "./entra-login.config.ts";

/** Build the exact env Claude Code needs on the Buckle wire (P0.2c
 *  contract). The PAT rides the URL (url-pat) or the auth header
 *  (bearer-pat); the Entra token rides the other slot. Either way the
 *  PAT is placed, never logged. CLAUDE_CONFIG_DIR gets a fresh
 *  onboarding-complete dir — the default config dir's keychain touch
 *  hangs headless runs (live lesson, P0.2c receipt). */
export const buildCliEnv = (
  config: Config,
  pat: string,
  entraToken: string,
  claudeConfigDir: string,
): Record<string, string> => ({
  ...(config.mode === "url-pat"
    ? {
        ANTHROPIC_BASE_URL: `${config.gatewayUrl}/w/${config.lane}/${pat}`,
        ANTHROPIC_AUTH_TOKEN: entraToken,
      }
    : {
        ANTHROPIC_BASE_URL: `${config.gatewayUrl}/w/${config.lane}`,
        ANTHROPIC_AUTH_TOKEN: pat,
        ANTHROPIC_CUSTOM_HEADERS: JSON.stringify({ Authorization: `Bearer ${entraToken}` }),
      }),
  CLAUDE_CONFIG_DIR: claudeConfigDir,
});
