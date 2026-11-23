// buckle.catalog.fetch.ts — the OWN catalog: FETCHED from every
// provider (law c: never declared), mapped through the wire schema,
// cached a moment (the catalog is hot; providers are not). A dead
// provider contributes NOTHING (fail-closed for its rows only — a
// brief grace from the last good fetch, then honest emptiness); the
// fault is classified + logged at the seam, never swallowed. The
// federated VIEW lives in buckle.catalog.view.ts — this module only
// fetches own rows. Diverges from the old models-route deliberately:
// a hub catalog CARRIES provenance (origin url per row) — it is not
// a seat proxy hiding its candidates.
import { z } from "zod";
import { BuckleProvider, type BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { BuckleModelWire, type BuckleModelsResponse } from "../schemas/buckle.model.wire.zod.ts";
import {
  KNOWN_PROVIDERS,
  type KnownProviderLabel,
} from "../schemas/buckle.provider.registry.zod.ts";
import { bodyJson, httpSend, logFault } from "../fault.ts";
import type { Fault } from "../schemas/buckle.fault.zod.ts";
import { continueTraceparent } from "../trace/buckle.trace.export.ts";
import type { TokenReader } from "../federation/buckle.federation.peer.ts";
import { userIdOf } from "../lane.ts";

const _CacheEntrySchema = z.object({
  at: z.number().int().min(0),
  rows: z.array(BuckleModelWire),
});
type CacheEntry = z.output<typeof _CacheEntrySchema>;
const cache = new Map<string, CacheEntry>();

const ProviderCatalogSchema = z.object({ data: z.array(z.unknown()).optional() }).passthrough();

const ProviderRowSchema = z.object({ id: z.unknown() }).passthrough();

/** one provider registry entry, resolved for fetching: its label,
 *  its url, its settings row. zod-derived (the type law) and really
 *  parsed at composition — the triple is checked once, in buildCatalog. */
const ProviderFetchSchema = z
  .object({
    label: z.string().min(1),
    url: z.url(),
    provider: BuckleProvider,
  })
  .strict();
type ProviderEntry = z.output<typeof ProviderFetchSchema>;

/** what a fetch rides on. The factory's real job: derive the cache
 *  TTL and the GRACE window (3x) from the one knob — the 3 lives
 *  exactly here, never at a check site. */
function createFetchCall(parts: {
  tokenOf: TokenReader;
  traceparent: string;
  timeouts: BuckleSettings["timeouts"];
}) {
  return {
    ...parts,
    ttlMs: parts.timeouts.catalog_cache_ms,
    graceMs: parts.timeouts.catalog_grace_ms ?? parts.timeouts.catalog_cache_ms * 3,
  };
}
type FetchCall = ReturnType<typeof createFetchCall>;

/** the fetch's request headers: continued trace, the seat's key when
 *  one is configured, plus any headers the registry demands. A BYOC
 *  provider (user_token) carries the CALLER's /w/ token instead —
 *  no unit key exists for it, so the catalog rides the user's own
 *  credential (cached under the PSEUDONYMOUS user id, never the
 *  credential; one user's rows are never served to another) */
function headersOf(
  entry: ProviderEntry,
  call: FetchCall,
  userToken: string | null,
): Record<string, string> {
  const secret = entry.provider.user_token
    ? userToken
    : entry.provider.key !== undefined
      ? call.tokenOf(entry.provider.key)
      : null;
  const known = KNOWN_PROVIDERS[entry.label as KnownProviderLabel];
  return {
    traceparent: continueTraceparent(call.traceparent),
    ...(secret === null ? {} : { authorization: `Bearer ${secret}` }),
    ...(known?.catalog_headers ?? {}),
  };
}

/** map a provider's raw rows onto the wire — id verbatim when the
 *  row carries a string id, the WHOLE raw row as meta (pure) */
function wireRowsOf(data: unknown[], entry: ProviderEntry): BuckleModelWire[] {
  const rows: BuckleModelWire[] = [];
  for (const raw of data) {
    const row = ProviderRowSchema.safeParse(raw);
    // litellm's /v1/models payload does NOT carry model_info.id — the
    // per-leg upstream is only known from the engine config, which the
    // gate does not read. AZURE_LEG_IDS: the deployed azure deployments
    // (fleet-buckle-openai); kept in sync by the operator when legs land.
    const AZURE_LEG_IDS = new Set(["gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-astra"]);
    const rowId = row.success && typeof row.data.id === "string" ? row.data.id : "";
    const rawRec = raw as { owned_by?: string };
    const legLabel = AZURE_LEG_IDS.has(rowId)
      ? "azure"
      : (rawRec.owned_by && rawRec.owned_by !== "openai" ? rawRec.owned_by : null);
    const parsed = BuckleModelWire.safeParse({
      id: row.success && typeof row.data.id === "string" ? row.data.id : undefined,
      origin: { kind: "provider", label: legLabel ?? entry.label, url: entry.url },
      meta: raw,
    });
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

/** send one catalog request and parse the payload: rows on 2xx with
 *  a data array, else a fault (logged by the CALLER at the seam) */
async function fetchRows(
  entry: ProviderEntry,
  call: FetchCall,
  userToken: string | null,
): Promise<{ ok: true; rows: BuckleModelWire[] } | { ok: false; fault: Fault }> {
  const sent = await httpSend(
    `${entry.url.replace(/\/$/, "")}/models`,
    { headers: headersOf(entry, call, userToken) },
    call.timeouts.provider_fetch_ms,
  );
  if (!sent.ok) return { ok: false, fault: sent.fault };
  const body = await bodyJson(sent);
  if (!body.ok) return { ok: false, fault: body.fault };
  const catalog = ProviderCatalogSchema.safeParse(body.data);
  if (!catalog.success || catalog.data.data === undefined)
    return {
      ok: false,
      fault: {
        kind: "malformed",
        detail: (catalog.error?.issues ?? []).map((i) => i.message).join("; ") || "no data rows",
      },
    };
  return { ok: true, rows: wireRowsOf(catalog.data.data, entry) };
}

/** a failed fetch answers from grace when the last good entry is
 *  fresh enough (the grace window createFetchCall derived), else
 *  honest emptiness */
function cacheEmpty(
  key: string,
  previous: CacheEntry | undefined,
  graceMs: number,
): BuckleModelWire[] {
  if (previous !== undefined && Date.now() - previous.at < graceMs) return previous.rows; // brief grace from the last good fetch
  cache.delete(key);
  return [];
}

async function fetchProvider(
  entry: ProviderEntry,
  call: FetchCall,
  userToken: string | null,
): Promise<BuckleModelWire[]> {
  // BYOC catalogs are PER-USER (the caller's PAT decides the entitled
  // rows): the cache key carries the pseudonymous user id — never the
  // credential — so one user's rows can never be served to another.
  // A tokenless caller gets honest emptiness: no fetch, no warm rows
  // fetched under someone else's PAT (P0.2b — the refusal names the
  // /w/ contract at the pipeline).
  const key = entry.provider.user_token
    ? `${entry.label}|${entry.url}|${userToken === null ? "anon" : userIdOf(userToken)}`
    : `${entry.label}|${entry.url}`;
  if (entry.provider.user_token && userToken === null) return [];
  const hit = cache.get(key);
  if (hit !== undefined && Date.now() - hit.at < call.ttlMs) return hit.rows;

  const fetched = await fetchRows(entry, call, userToken);
  if (!fetched.ok) {
    logFault("catalog.fetch", key, fetched.fault);
    return cacheEmpty(key, hit, call.graceMs);
  }
  cache.set(key, { at: Date.now(), rows: fetched.rows });
  return fetched.rows;
}

export async function buildCatalog(
  settings: BuckleSettings,
  traceparent: string,
  tokenOf: TokenReader = () => null,
  userToken: string | null = null,
): Promise<BuckleModelsResponse> {
  const call = createFetchCall({ tokenOf, traceparent, timeouts: settings.timeouts });
  const batches = await Promise.all(
    Object.entries(settings.providers ?? {}).map(([label, provider]) =>
      fetchProvider(
        ProviderFetchSchema.parse({ label, url: provider.url, provider }),
        call,
        userToken,
      ),
    ),
  );
  return { hub: settings.hub.label, models: batches.flat() };
}
