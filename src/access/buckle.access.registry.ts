// access/buckle.access.registry.ts — every authenticated face goes through HERE:
// a Bearer key authenticates as the principal whose 0600 key file (one
// per principal under keys.principals_dir — minted, never typed) holds
// exactly that value; grants (scopes) decide the face. No registry
// configured = fail CLOSED (401). healthz + /metrics stay open — health
// is outside-process by law.
import { join } from "node:path";
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import type { BuckleScope } from "../schemas/buckle.access.zod.ts";
import { listDir, readToken } from "../settings.ts";

const KEY_PREFIX = "principal.";
const KEY_SUFFIX = ".key";

/** the ids the access registry knows — an empty roster authenticates
 *  nobody (fail CLOSED); dir scan faults already logged at the reader */
function candidateKeys(settings: BuckleSettings): { dir: string; ids: string[] } | null {
  const dir = settings.keys?.principals_dir;
  const registry = settings.access;
  if (dir === undefined || registry === undefined) return null;
  const ids = registry.principals.map((p) => p.id);
  return listDir(dir) === null ? null : { dir, ids };
}

/** the principal whose key file under dir holds exactly this bearer
 *  value (unreadable key = that principal cannot authenticate) */
function principalHoldingKey(dir: string, ids: string[], bearer: string): string | null {
  for (const id of ids) {
    const value = readToken(join(dir, `${KEY_PREFIX}${id}${KEY_SUFFIX}`));
    if (value === bearer) return id;
  }
  return null;
}

/** authenticate a Bearer token → principal id (null = nobody). */
export function authenticate(settings: BuckleSettings, bearer: string | null): string | null {
  if (bearer === null || !bearer.startsWith("bksk_")) return null;
  const keys = candidateKeys(settings);
  if (keys === null) return null;
  return principalHoldingKey(keys.dir, keys.ids, bearer);
}

/** does the principal hold the scope on THIS buckle? */
export function holdsScope(
  settings: BuckleSettings,
  principal: string | null,
  scope: BuckleScope,
): boolean {
  if (principal === null) return false;
  const grants = settings.access?.grants ?? [];
  return grants.some((g) => g.principal === principal && g.scopes.includes(scope));
}

/** the Authorization bearer (null when absent/malformed). */
export function bearerOf(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h === null || !h.startsWith("Bearer ")) return null;
  const token = h.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}
