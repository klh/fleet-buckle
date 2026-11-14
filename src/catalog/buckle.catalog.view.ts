// catalog/buckle.catalog.view.ts — the per-principal federated VIEW: own
// provider rows + downstream peers' DIRECT rows, filtered by
// grant.peers (absent = every configured peer — the matrix's carol;
// an explicit [] = own rows only). Pulled through the ONE peer seam
// (federation.peer) with the peer token (models.list is checked at
// EVERY hop, against the peer's OWN registry). The catalog is a SET:
// one row per model id — a machine sitting under several hubs never
// sees duplicates. Downstream only.
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import {
  BuckleModelWire,
  BuckleModelsResponse,
} from "../schemas/buckle.model.wire.zod.ts";
import { peerJson, type TokenReader } from "../federation/buckle.federation.peer.ts";
import { buildCatalog } from "./buckle.catalog.fetch.ts";

/** the labels a grant admits: absent = every configured peer; an
 *  explicit list (including []) = exactly those labels */
function admittedPeers(settings: BuckleSettings, principal: string): string[] {
  const configured = Object.keys(settings.hubs ?? {});
  const grant = (settings.access?.grants ?? []).find(
    (g) => g.principal === principal,
  );
  return grant?.peers ?? configured;
}

/** the peer's row re-originated for OUR view: provenance becomes WHERE
 *  WE GOT IT (kind=buckle, label, url) — schema-validated, never
 *  hand-cast; a malformed row contributes nothing (logged upstream) */
function hopRowOf(
  row: BuckleModelWire,
  label: string,
  url: string,
): BuckleModelWire | null {
  const hop = BuckleModelWire.safeParse({
    id: row.id,
    origin: { kind: "buckle", label, url },
  });
  return hop.success ? hop.data : null;
}

export async function buildFederatedCatalog(
  settings: BuckleSettings,
  principal: string,
  tokenOf: TokenReader,
  traceparent: string,
): Promise<BuckleModelsResponse> {
  const own = await buildCatalog(settings, traceparent, tokenOf);
  const admitted = admittedPeers(settings, principal);

  // the SET law: one row per model id, no matter how many hubs serve
  // it. Precedence is deterministic: own rows win over peers (never
  // hop for what we serve), then peers in hubs-declaration order. A
  // dead or denied peer contributes nothing — its fault is logged at
  // the seam, named, never swallowed. Only a peer's DIRECT rows
  // (origin kind=provider) ride our catalog: transit copies would
  // duplicate (the topology view shows the depth).
  const seen = new Set<string>();
  const models: BuckleModelWire[] = [];
  const admit = (rows: Iterable<BuckleModelWire>): void => {
    for (const row of rows)
      if (!seen.has(row.id)) {
        seen.add(row.id);
        models.push(row);
      }
  };

  admit(own.models);
  for (const [label, peer] of Object.entries(settings.hubs ?? {})) {
    if (!admitted.includes(label)) continue;
    const pulled = await peerJson(
      "catalog.view",
      peer,
      "/v1/models",
      BuckleModelsResponse,
      tokenOf,
      settings.timeouts.peer_pull_ms,
      traceparent,
    );
    if (pulled.ok)
      admit(
        pulled.data.models
          .filter((row) => row.origin.kind === "provider")
          .flatMap((row) => {
            const hop = hopRowOf(row, label, peer.url);
            return hop === null ? [] : [hop];
          }),
      );
  }
  return { hub: settings.hub.label, models };
}
