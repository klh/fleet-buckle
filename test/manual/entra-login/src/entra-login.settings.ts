import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Fresh, onboarding-complete Claude config dir (0600) — the P0.2c live
 *  lesson: the DEFAULT config dir's keychain/OAuth touch hangs a
 *  no-TTY run before any HTTP leaves the machine. */
export const freshClaudeConfigDir = (): string => {
  const dir = join(tmpdir(), `entra-login-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".claude.json"), `${JSON.stringify({ hasCompletedOnboarding: true })}\n`);
  chmodSync(join(dir, ".claude.json"), 0o600);
  return dir;
};
