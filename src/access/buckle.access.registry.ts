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

/** authenticate a Bearer token → principal id (null = nobody). */
export function authenticate(
  settings: BuckleSettings,
  bearer: string | null,
): string | null {
  if (bearer === null || !bearer.startsWith("bksk_")) return null;
  const dir = settings.keys?.principals_dir;
  if (dir === undefined) return null; // no keys minted = nobody
  const registry = settings.access;
  if (registry === undefined) return null; // fail closed
  const known = new Set(registry.principals.map((p) => p.id));
  // unreadable dir = fault logged at the reader; auth fails CLOSED
  const files = listDir(dir);
  if (files === null) return null;
  for (const f of files) {
    if (!f.startsWith(KEY_PREFIX) || !f.endsWith(KEY_SUFFIX)) continue;
    const id = f.slice(KEY_PREFIX.length, -KEY_SUFFIX.length);
    if (!known.has(id)) continue;
    // unreadable key file (fault logged at the reader): that
    // principal cannot authenticate
    const value = readToken(join(dir, f));
    if (value !== null && value === bearer) return id;
  }
  return null;
}

/** does the principal hold the scope on THIS buckle? */
export function holdsScope(
  settings: BuckleSettings,
  principal: string | null,
  scope: BuckleScope,
): boolean {
  if (principal === null) return false;
  const grants = settings.access?.grants ?? [];
  return grants.some(
    (g) => g.principal === principal && g.scopes.includes(scope),
  );
}

/** the Authorization bearer (null when absent/malformed). */
export function bearerOf(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h === null || !h.startsWith("Bearer ")) return null;
  const token = h.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}
