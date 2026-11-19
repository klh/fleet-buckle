// access/buckle.access.registry.ts — every authenticated face goes through HERE:
// a Bearer key authenticates as the principal whose 0600 key file (one
// per principal under keys.principals_dir — minted, never typed) holds
// exactly that value; grants (scopes) decide the face. No registry
// configured = fail CLOSED (401). healthz + /metrics stay open — health
// is outside-process by law.
import { z } from "zod";
import { join } from "node:path";
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import type { BuckleScope } from "../schemas/buckle.access.zod.ts";
import { attempt } from "../fault.ts";
import { listDir, readToken } from "../settings.ts";

const KEY_PREFIX = "principal.";
const KEY_SUFFIX = ".key";

/** the ids the access registry knows — an empty roster authenticates
 *  nobody (fail CLOSED); dir scan faults already logged at the reader */
function candidateKeys(settings: BuckleSettings): { dir: string; ids: string[] } | null {
  const dir = settings.keys?.principals_dir;
  const registry = settings.access;
  if (dir === undefined || registry === undefined) return null;
  const ids = registry.principals.filter((p) => !p.revoked).map((p) => p.id);
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
  if (principal === null || isRevoked(settings, principal)) return false;
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

/** revoked (or unknown) principals never authenticate or hold scopes */
export function isRevoked(settings: BuckleSettings, principal: string): boolean {
  const p = settings.access?.principals.find((x) => x.id === principal);
  return p === undefined || p.revoked;
}

const EngineKeyShapeSchema = z.object({
  principalId: z.string(),
  keyAlias: z.string(),
  /** secret PATH, never a value */
  keyPath: z.string(),
  teams: z.array(z.string()),
  maxBudget: z.number().optional(),
  budgetDuration: z.string().optional(),
  rpmLimit: z.number().optional(),
  /** ordinary model keys never carry admin routes */
  routeFamilies: z.array(z.enum(["chat", "responses", "embeddings", "models"])),
});
export type EngineKeyShape = z.output<typeof EngineKeyShapeSchema>;

const EngineKeyVerdictSchema = z.union([
  z.object({ ok: z.literal(true), key: EngineKeyShapeSchema }),
  z.object({ ok: z.literal(false), status: z.union([z.literal(401), z.literal(403), z.literal(503)]), reason: z.string() }),
]);
export type EngineKeyVerdict = z.output<typeof EngineKeyVerdictSchema>;

/** principal -> scoped LiteLLM virtual-key shape. Unknown/revoked = 401.
 *  `admin` scope never becomes an engine model-key route (admin escalation denied). */
export function engineKeyFor(
  settings: BuckleSettings,
  principal: string | null,
  workerKeyDir: string | undefined,
): EngineKeyVerdict {
  if (principal === null) return { ok: false, status: 401, reason: "unauthenticated" };
  const p = settings.access?.principals.find((x) => x.id === principal);
  if (p === undefined || p.revoked) return { ok: false, status: 401, reason: "revoked-or-unknown" };
  if (!holdsScope(settings, principal, "models.use")) {
    return { ok: false, status: 403, reason: "no models.use grant" };
  }
  const grant = settings.access?.grants.find((g) => g.principal === principal);
  const tier = settings.access?.tiers.find((t) => (p.tier ? t.label === p.tier : t.kind === p.kind));
  const lim = { ...tier, ...grant?.limits, ...p.limits };
  // BYOC humans carry their own credential; never the engine-held worker one
  const keyPath = p.kind === "human" ? p.byoc_key_path : join(workerKeyDir ?? "", `${KEY_PREFIX}${p.id}${KEY_SUFFIX}`);
  if (keyPath === undefined || (p.kind !== "human" && workerKeyDir === undefined)) {
    return { ok: false, status: 503, reason: "no credential path; fail closed" };
  }
  return {
    ok: true,
    key: {
      principalId: p.id,
      keyAlias: p.id,
      keyPath,
      teams: p.groups,
      ...(lim.max_budget !== undefined ? { maxBudget: lim.max_budget } : {}),
      ...(lim.budget_duration !== undefined ? { budgetDuration: lim.budget_duration } : {}),
      ...(lim.max_rpm !== undefined ? { rpmLimit: lim.max_rpm } : {}),
      routeFamilies: ["chat", "responses", "embeddings", "models"],
    },
  };
}

const CredentialVerdictSchema = z.union([
  z.object({ ok: z.literal(true), token: z.string() }),
  z.object({ ok: z.literal(false), status: z.union([z.literal(401), z.literal(503)]) }),
]);
type CredentialVerdict = z.output<typeof CredentialVerdictSchema>;

/** credential resolution: a BYOC failure is a denial, never a worker-key fallback;
 *  a DB/engine failure fails closed (503). */
export function resolveCredential(
  key: EngineKeyShape,
  kind: string,
  read: (path: string) => string | null,
  workerKeyPath?: string,
): CredentialVerdict {
  const got = attempt<{ token: string | null } | null>(
    () => ({ token: read(key.keyPath) }),
    () => null,
  );
  if (got === null) return { ok: false, status: 503 };
  const token = got.token;
  if (token !== null && token.length > 0) return { ok: true, token };
  void workerKeyPath; // deliberately unused: no fallback
  return { ok: false, status: kind === "human" ? 401 : 503 };
}

/** per-principal engine credential for the forward path: swaps the shared
 *  master-key path for the principal's scoped key. Null = fail closed
 *  (no master fallback; BYOC humans ride the user leg, never the engine key). */
export function scopedTokenReader(
  settings: BuckleSettings,
  principal: string | null,
  base: (path: string) => string | null,
): (path: string) => string | null {
  const master = settings.keys?.engine;
  const dir = settings.keys?.principals_dir;
  if (master === undefined || principal === null || dir === undefined) return base;
  const p = settings.access?.principals.find((x) => x.id === principal);
  if (p === undefined || p.kind === "human") return base;
  return (path) => {
    if (path !== master) return base(path);
    if (base(master) === null) return null; // gate off (unreadable master): open engine, as before
    const v = base(join(dir, `engine.${p.id}.key`));
    return v !== null && v.length > 0 ? v : null;
  };
}

/** LiteLLM `/key/generate` body for a runner virtual key (DB-backed). Team
 *  and budget come from the registry; models-only routes, never admin. A
 *  verdict failure (revoked, no grant, admin-only) yields null = mint nothing. */
export function virtualKeyBody(
  settings: BuckleSettings,
  principal: string,
  workerKeyDir: string | undefined,
): Record<string, unknown> | null {
  const v = engineKeyFor(settings, principal, workerKeyDir);
  if (!v.ok) return null;
  const k = v.key;
  return {
    key_alias: k.keyAlias,
    user_id: k.principalId, // per-principal: cross-user spend/keys never shared
    team_id: k.teams[0],
    metadata: { teams: k.teams },
    ...(k.maxBudget !== undefined ? { max_budget: k.maxBudget } : {}),
    ...(k.budgetDuration !== undefined ? { budget_duration: k.budgetDuration } : {}),
    ...(k.rpmLimit !== undefined ? { rpm_limit: k.rpmLimit } : {}),
    allowed_routes: ["llm_api_routes"],
  };
}
