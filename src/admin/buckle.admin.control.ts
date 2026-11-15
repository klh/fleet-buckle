// buckle.admin.control.ts — the GUI's control seam (every face
// demands scope `admin`): the state snapshot, principal-key mint
// (settings-declared principals ONLY — the roster is code, the key
// is a minted secret), and hub edits through the over layer
// (candidate → mergeSettings parse → atomic 0600 write → reload →
// swap: the running server NEVER restarts). zod law: every body and
// view parses through a NAMED schema; secrets are files, values
// never logged.
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  mergeSettingsSafe,
  type BuckleSettings,
} from "../schemas/buckle.settings.zod.ts";
import { loadSettings, type SettingsPaths } from "../settings.ts";

/** GET /admin/state — the GUI's whole world in one pull (never a
 *  secret: provider key PATHS exist, key VALUES do not) */
const AdminStateView = z
  .object({
    hub: z.string(),
    providers: z
      .array(
        z.object({
          label: z.string(),
          url: z.string(),
          dialect: z.string(),
          /** BYOC: the credential rides the caller's /w/ token */
          user_token: z.boolean(),
        }),
      )
      .default([]),
    lanes: z.array(z.object({ id: z.string(), model: z.string() })).default([]),
    principals: z
      .array(z.object({ id: z.string(), kind: z.string(), scopes: z.array(z.string()) }))
      .default([]),
    hubs: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
  })
  .strict();
type AdminStateView = z.output<typeof AdminStateView>;

/** the view of what IS (settings rows, never secrets) */
export function adminState(settings: BuckleSettings): AdminStateView {
  return AdminStateView.parse({
    hub: settings.hub.label,
    providers: Object.entries(settings.providers ?? {}).map(([label, p]) => ({
      label,
      url: p.url,
      dialect: p.dialect,
      user_token: p.user_token,
    })),
    lanes: (settings.lanes ?? []).map((l) => ({ id: l.id, model: l.model })),
    principals: (settings.access?.principals ?? []).map((p) => ({
      id: p.id,
      kind: p.kind,
      scopes:
        settings.access?.grants.find((g) => g.principal === p.id)?.scopes ?? [],
    })),
    hubs: Object.entries(settings.hubs ?? {}).map(([label, h]) => ({
      label,
      url: h.url,
    })),
  });
}

/** POST /admin/keys {principal} — mint a 0600 key file for a
 *  settings-DECLARED principal (the roster is code; the GUI cannot
 *  invent principals). Returns the value ONCE; a second ask is a
 *  conflict (never re-mint over a live key). */
export const AdminKeyMintRequest = z
  .object({ principal: z.string().min(1) })
  .strict();
export type AdminKeyMintRequest = z.output<typeof AdminKeyMintRequest>;

type MintOutcome =
  | { kind: "minted"; principal: string; key: string; file: string }
  | { kind: "unknown-principal"; principal: string }
  | { kind: "already-keyed"; principal: string; file: string }
  | { kind: "no-dir" };

export function mintPrincipalKey(
  settings: BuckleSettings,
  ask: AdminKeyMintRequest,
): MintOutcome {
  const dir = settings.keys?.principals_dir;
  if (dir === undefined) return { kind: "no-dir" };
  const declared = (settings.access?.principals ?? []).some(
    (p) => p.id === ask.principal,
  );
  if (!declared) return { kind: "unknown-principal", principal: ask.principal };
  const file = join(dir, `principal.${ask.principal}.key`);
  if (existsSync(file)) return { kind: "already-keyed", principal: ask.principal, file };
  const key = `bksk_${randomBytes(24).toString("base64url")}`;
  atomicSecret(file, `${key}\n`);
  return { kind: "minted", principal: ask.principal, key, file };
}

/** POST /admin/hubs — provider/hub/lanes rows through the over
 *  layer. The candidate MERGES over current settings and parses
 *  THROUGH the schema first (drift fails LOUD, nothing is written);
 *  then the over file lands atomically (0600) and the caller
 *  reloads. */
export const AdminHubEditRequest = z
  .object({
    providers: z.record(z.string(), z.unknown()).optional(),
    hubs: z.record(z.string(), z.unknown()).optional(),
    lanes: z.array(z.unknown()).optional(),
  })
  .strict();
export type AdminHubEditRequest = z.output<typeof AdminHubEditRequest>;

type HubEditOutcome =
  | { kind: "applied"; settings: BuckleSettings; over: string }
  | { kind: "no-over"; detail: string }
  | { kind: "rejected"; detail: string };

export async function applyHubEdit(
  paths: SettingsPaths | null,
  current: BuckleSettings,
  edit: AdminHubEditRequest,
): Promise<HubEditOutcome> {
  if (paths === null || paths.over === undefined)
    return {
      kind: "no-over",
      detail: "this buckle runs without an over layer — set BUCKLE_SETTINGS_OVER to its path",
    };
  // drift fails LOUD before anything is written: the merged
  // candidate must parse through the settings schema (the
  // non-throwing twin — a bad edit is a rejected outcome, never an
  // exception at this boundary)
  const merged = mergeSettingsSafe(current, edit);
  if (!merged.ok) return { kind: "rejected", detail: `the edit does not parse: ${merged.detail}` };
  // the over layer holds EXACTLY the edit (unit file stays pristine)
  atomicSecret(paths.over, `${JSON.stringify(edit, null, 2)}\n`);
  return { kind: "applied", settings: await loadSettings(paths), over: paths.over };
}

/** the one secret-write idiom: tmp file + rename, 0600 */
function atomicSecret(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, content, { mode: 0o600 });
  chmodSync(tmp, 0o600); // umask never widens a secret
  renameSync(tmp, file);
}
