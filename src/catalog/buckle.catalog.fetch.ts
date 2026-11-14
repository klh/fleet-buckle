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
import type {
  BuckleSettings,
  BuckleProvider,
} from "../schemas/buckle.settings.zod.ts";
import {
  BuckleModelWire,
  type BuckleModelsResponse,
} from "../schemas/buckle.model.wire.zod.ts";
import {
  KNOWN_PROVIDERS,
  type KnownProviderLabel,
} from "../schemas/buckle.provider.registry.zod.ts";
import { bodyJson, httpSend, logFault } from "../fault.ts";
import { continueTraceparent } from "../live/buckle.live.trace.ts";
import type { TokenReader } from "../federation/buckle.federation.peer.ts";

export const CacheEntrySchema = z.object({
  at: z.number().int().min(0),
  rows: z.array(BuckleModelWire),
});
type CacheEntry = z.output<typeof CacheEntrySchema>;
const cache = new Map<string, CacheEntry>();

const ProviderCatalogSchema = z
  .object({ data: z.array(z.unknown()).optional() })
  .passthrough();

const ProviderRowSchema = z.object({ id: z.unknown() }).passthrough();

async function fetchProvider(
  label: string,
  url: string,
  tokenOf: TokenReader,
  provider: BuckleProvider,
  traceparent: string,
  timeouts: BuckleSettings["timeouts"],
): Promise<BuckleModelWire[]> {
  const key = `${label}|${url}`;
  const hit = cache.get(key);
  if (hit !== undefined && Date.now() - hit.at < timeouts.catalog_cache_ms)
    return hit.rows;

  // every recognized provider serves its catalog at {url}/models;
  // the registry carries any headers the seat demands
  const secret = provider.key !== undefined ? tokenOf(provider.key) : null;
  const known = KNOWN_PROVIDERS[label as KnownProviderLabel];
  const sent = await httpSend(
    `${url.replace(/\/$/, "")}/models`,
    {
      headers: {
        traceparent: continueTraceparent(traceparent),
        ...(secret === null ? {} : { authorization: `Bearer ${secret}` }),
        ...(known?.catalog_headers ?? {}),
      },
    },
    timeouts.provider_fetch_ms,
  );
  if (!sent.ok) {
    logFault("catalog.fetch", key, sent.fault);
    return cacheEmpty(key, hit, timeouts);
  }
  const body = await bodyJson(sent);
  if (!body.ok) {
    logFault("catalog.fetch", key, body.fault);
    return cacheEmpty(key, hit, timeouts);
  }
  const catalog = ProviderCatalogSchema.safeParse(body.data);
  if (!catalog.success || catalog.data.data === undefined) {
    logFault("catalog.fetch", key, {
      kind: "malformed",
      detail: (catalog.error?.issues ?? []).map((i) => i.message).join("; ") || "no data rows",
    });
    return cacheEmpty(key, hit, timeouts);
  }
  const rows: BuckleModelWire[] = [];
  for (const raw of catalog.data.data) {
    const row = ProviderRowSchema.safeParse(raw);
    const parsed = BuckleModelWire.safeParse({
      id:
        row.success && typeof row.data.id === "string"
          ? row.data.id
          : undefined,
      origin: { kind: "provider", label, url },
      meta: raw,
    });
    if (parsed.success) rows.push(parsed.data);
  }
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

function cacheEmpty(
  key: string,
  previous: CacheEntry | undefined,
  timeouts: BuckleSettings["timeouts"],
): BuckleModelWire[] {
  if (
    previous !== undefined &&
    Date.now() - previous.at < timeouts.catalog_cache_ms * 3
  )
    return previous.rows; // brief grace from the last good fetch
  cache.delete(key);
  return [];
}

export async function buildCatalog(
  settings: BuckleSettings,
  traceparent: string,
  tokenOf: TokenReader = () => null,
): Promise<BuckleModelsResponse> {
  const providers = Object.entries(settings.providers ?? {});
  const batches = await Promise.all(
    providers.map(([label, p]) =>
      fetchProvider(label, p.url, tokenOf, p, traceparent, settings.timeouts),
    ),
  );
  return { hub: settings.hub.label, models: batches.flat() };
}
