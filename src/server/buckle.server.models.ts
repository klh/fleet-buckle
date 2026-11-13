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
