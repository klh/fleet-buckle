// buckle.server.models.ts — the catalog: FETCHED from every provider
// (law c: never declared), mapped through the wire schema, cached a
// moment (the catalog is hot; providers are not). A dead provider
// contributes NOTHING (fail-closed for its rows only); metadata rides
// verbatim. Peer (buckle-origin) rows land with federation (commit 4).
import { z } from "zod";
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import {
  BuckleModelWire,
  type BuckleModelsResponse,
} from "../schemas/buckle.model.wire.zod.ts";
import { continueTraceparent } from "./buckle.server.telemetry.ts";

const CACHE_TTL_MS = 2000;
const FETCH_TIMEOUT_MS = 1500;

const CacheEntrySchema = z.object({
  at: z.number().int().min(0),
  rows: z.array(BuckleModelWire),
});
type CacheEntry = z.output<typeof CacheEntrySchema>;
const cache = new Map<string, CacheEntry>();

const ProviderRowSchema = z.object({ id: z.unknown() }).passthrough();
type ProviderRow = z.output<typeof ProviderRowSchema>;

async function fetchProvider(
  label: string,
  url: string,
  traceparent: string,
): Promise<BuckleModelWire[]> {
  const key = `${label}|${url}`;
  const hit = cache.get(key);
  if (hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows;
  try {
    const r = await fetch(`${url.replace(/\/$/, "")}/v1/models`, {
      headers: { traceparent: continueTraceparent(traceparent) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) return cacheEmpty(key, hit);
    const body = (await r.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) return cacheEmpty(key, hit);
    const rows: BuckleModelWire[] = [];
    for (const raw of body.data as ProviderRow[]) {
      const parsed = BuckleModelWire.safeParse({
        id: typeof raw.id === "string" ? raw.id : undefined,
        origin: { kind: "provider", label, url },
        meta: raw,
      });
      if (parsed.success) rows.push(parsed.data);
    }
    cache.set(key, { at: Date.now(), rows });
    return rows;
  } catch {
    return cacheEmpty(key, hit); // dead provider: last-known rows briefly, then nothing
  }
}

function cacheEmpty(key: string, previous: CacheEntry | undefined): BuckleModelWire[] {
  if (previous !== undefined && Date.now() - previous.at < CACHE_TTL_MS * 3)
    return previous.rows; // brief grace from the last good fetch
  cache.delete(key);
  return [];
}

export async function buildCatalog(
  settings: BuckleSettings,
  traceparent: string,
): Promise<BuckleModelsResponse> {
  const providers = Object.entries(settings.providers ?? {});
  const batches = await Promise.all(
    providers.map(([label, p]) => fetchProvider(label, p.url, traceparent)),
  );
  return { hub: settings.hub.label, models: batches.flat() };
}

export type TokenReader = (file: string) => string | null;

/** the per-principal VIEW: own rows + downstream peers' rows, filtered
 *  by grant.peers (absent/empty-handled: default [] means ALL peers —
 *  zod default; explicit [] in a grant means own only). Pulled with the
 *  peer token (models.list is checked at EVERY hop). */
export async function buildFederatedCatalog(
  settings: BuckleSettings,
  principal: string,
  tokenOf: TokenReader,
  traceparent: string,
): Promise<BuckleModelsResponse> {
  const own = await buildCatalog(settings, traceparent);
  const grant = (settings.access?.grants ?? []).find(
    (g) => g.principal === principal,
  );
  if (grant === undefined) return own;
  const configured = Object.entries(settings.hubs ?? {});
  // peers ABSENT = every configured peer; an explicit list (including
  // the empty list = own rows only) rides exactly those labels
  const allowed =
    grant.peers ?? configured.map(([label]) => label);
  // the federated catalog is a SET of ids: a machine configuring b1+b2+b3
  // as peers never grows duplicate or triplicate rows — one row per model
  // id, no matter how many hubs serve it. Precedence is deterministic:
  // own rows win over peers (never hop for what we serve), and among peers
  // the hubs-declaration order wins. A dead peer simply contributes nothing.
  const seen = new Set<string>();
  const unique: BuckleModelWire[] = [];
  for (const row of own.models) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
  }
  const rows: BuckleModelWire[] = [];
  for (const [label, peer] of configured) {
    if (!allowed.includes(label)) continue;
    try {
      const headers: Record<string, string> = {
        traceparent: continueTraceparent(traceparent),
      };
      if (peer.token_file !== undefined) {
        const token = tokenOf(peer.token_file);
        if (token !== null) headers["authorization"] = `Bearer ${token}`;
      }
      const r = await fetch(`${peer.url.replace(/\/$/, "")}/v1/models`, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!r.ok) continue; // hop denied/unreachable: that peer's rows stay out
      // a peer buckle answers {hub, models:[BuckleModelWire]}. Only the
      // peer's DIRECT rows (origin kind=provider) ride our catalog —
      // transit copies would duplicate (the TREE shows the depth).
      // Provenance becomes WHERE WE GOT IT: origin kind=buckle, label.
      const body = (await r.json()) as {
        models?: { id?: unknown; origin?: { kind?: unknown } }[];
      };
      if (!Array.isArray(body.models)) continue;
      for (const raw of body.models) {
        if (raw.origin?.kind !== "provider") continue;
        const parsed = BuckleModelWire.safeParse({
          id: typeof raw.id === "string" ? raw.id : undefined,
          origin: { kind: "buckle", label, url: peer.url },
        });
        if (!parsed.success) continue;
        if (seen.has(parsed.data.id)) continue; // set law: first origin wins
        seen.add(parsed.data.id);
        rows.push(parsed.data);
      }
    } catch {
      // dead peer: no rows from it
    }
  }
  return { hub: settings.hub.label, models: [...unique, ...rows] };
}
