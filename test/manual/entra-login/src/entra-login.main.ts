import { readFileSync, statSync } from "node:fs";
import { PublicClientApplication } from "@azure/msal-node";
import { parseConfig, type Config } from "./entra-login.config.ts";
import { buildCliEnv } from "./entra-login.env.ts";
import { preflight } from "./entra-login.preflight.ts";
import { freshClaudeConfigDir } from "./entra-login.settings.ts";

/** MSAL 2.x requires an explicit browser opener — no shell-outs beyond
 *  the platform's own opener binary. */
const openBrowser = async (url: string): Promise<void> => {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  await Bun.spawn([opener, url]).exited;
};

/** argv: entra-login.main.ts <config.json> [claude args…] — config is a
 *  machine 0600 file; PAT lives in its own 0600 file (BYOC law: the
 *  user token is read, placed, and never printed). */
const [, , configPath, ...claudeArgs] = process.argv;
if (!configPath) {
  console.error("usage: bun entra-login.main.ts <config.json> [claude args…]");
  process.exit(1);
}

const mustBe0600 = (path: string): void => {
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600) {
    console.error(`${path}: mode ${mode.toString(8)} — secrets files must be 0600`);
    process.exit(1);
  }
};

const loadConfig = (path: string): Config => {
  mustBe0600(path);
  const result = parseConfig(JSON.parse(readFileSync(path, "utf8")));
  if (!result.ok) {
    console.error(`config rejected — ${result.fault.kind}: ${result.fault.detail}`);
    process.exit(1);
  }
  return result.value;
};

const acquireEntra = async (config: Config): Promise<string> => {
  const app = new PublicClientApplication({
    auth: { clientId: config.clientId, authority: `https://login.microsoftonline.com/${config.tenantId}` },
  });
  const result = await app.acquireTokenInteractive({ openBrowser, scopes: [config.scope] });
  if (!result?.accessToken) {
    console.error("entra sign-in produced no access token — rerun the script");
    process.exit(1);
  }
  return result.accessToken;
};

const run = async (): Promise<void> => {
  const config = loadConfig(configPath);
  mustBe0600(config.patFile);
  const pat = readFileSync(config.patFile, "utf8").trim();
  console.error(`entra sign-in (${config.tenantId}) — browser opens; MFA per tenant policy`);
  const entraToken = await acquireEntra(config);
  const check = await preflight(config, pat, entraToken);
  if (!check.ok) {
    console.error(`preflight failed — ${check.fault.kind}: ${check.fault.detail}`);
    process.exit(1);
  }
  console.error(`preflight ok (${check.models} entitled models) — launching ${config.claudeBin}`);
  const proc = Bun.spawn([config.claudeBin, ...claudeArgs], {
    env: { ...process.env, ...buildCliEnv(config, pat, entraToken, freshClaudeConfigDir()) },
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await proc.exited;
  process.exit(code);
};

await run();
