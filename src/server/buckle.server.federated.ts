// buckle.server.federated.ts — the per-principal federated VIEW:
// own provider rows + downstream peers' DIRECT rows, filtered by
// grant.peers (absent = every configured peer — the matrix's carol;
// an explicit [] = own rows only). Pulled with the peer token
// (models.list is checked at EVERY hop, against the peer's OWN
// registry). The catalog is a SET: one row per model id — a machine
// sitting under several hubs never sees duplicates. Downstream only.
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import {
  BuckleModelWire,
  BuckleModelsResponse,
} from "../schemas/buckle.model.wire.zod.ts";
import { continueTraceparent } from "./buckle.server.telemetry.ts";
import {
  buildCatalog,
  FETCH_TIMEOUT_MS,
} from "./buckle.server.models.ts";

/** reads a key/token file (secrets are paths, never values) */
export type TokenReader = (file: string) => string | null;

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
  const allowed = grant.peers ?? configured.map(([label]) => label);

  // the SET law: one row per model id, no matter how many hubs serve
  // it. Precedence is deterministic: own rows win over peers (never
  // hop for what we serve), then peers in hubs-declaration order. A
  // dead or denied peer simply contributes nothing.
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
      // a peer buckle answers OUR OWN wire face — parse it through the
      // same schema. Only the peer's DIRECT rows (origin kind=provider)
      // ride our catalog: transit copies would duplicate (the TREE
      // shows the depth). Provenance becomes WHERE WE GOT IT:
      // origin kind=buckle, label.
      const parsed = BuckleModelsResponse.safeParse(await r.json());
      if (!parsed.success) continue;
      for (const row of parsed.data.models) {
        if (row.origin.kind !== "provider") continue;
        const hop = BuckleModelWire.safeParse({
          id: row.id,
          origin: { kind: "buckle", label, url: peer.url },
        });
        if (!hop.success) continue;
        if (seen.has(hop.data.id)) continue; // set law: first origin wins
        seen.add(hop.data.id);
        rows.push(hop.data);
      }
    } catch {
      // dead peer: no rows from it
    }
  }
  return { hub: settings.hub.label, models: [...unique, ...rows] };
}
