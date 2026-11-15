// catalog/buckle.catalog.view.ts — the per-principal federated VIEW: own
// provider rows + downstream peers' DIRECT rows, filtered by
// grant.peers (absent = every configured peer — the matrix's carol;
// an explicit [] = own rows only). Pulled through the ONE peer seam
// (federation.peer) with the peer token (models.list is checked at
// EVERY hop, against the peer's OWN registry). The catalog is a SET:
// one row per model id — a machine sitting under several hubs never
// sees duplicates. Downstream only.
import type { BucklePeer, BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import { BuckleModelWire, BuckleModelsResponse } from "../schemas/buckle.model.wire.zod.ts";
import { peerJson, type TokenReader } from "../federation/buckle.federation.peer.ts";
import { buildCatalog } from "./buckle.catalog.fetch.ts";

/** the labels a grant admits: absent = every configured peer; an
 *  explicit list (including []) = exactly those labels */
function admittedPeers(settings: BuckleSettings, principal: string): string[] {
  const configured = Object.keys(settings.hubs ?? {});
  const grant = (settings.access?.grants ?? []).find((g) => g.principal === principal);
  return grant?.peers ?? configured;
}

/** the peer's row re-originated for OUR view: provenance becomes WHERE
 *  WE GOT IT (kind=buckle, label, url) — schema-validated, never
 *  hand-cast; a malformed row contributes nothing (logged upstream) */
function hopRowOf(row: BuckleModelWire, label: string, url: string): BuckleModelWire | null {
  const hop = BuckleModelWire.safeParse({
    id: row.id,
    origin: { kind: "buckle", label, url },
  });
  return hop.success ? hop.data : null;
}

/** a pulled peer catalog's DIRECT rows re-originated for our view —
 *  only origin kind=provider rides (transit copies would duplicate;
 *  the topology view shows the depth), malformed rows drop (pure) */
function directHopRowsOf(
  pulled: BuckleModelsResponse,
  label: string,
  url: string,
): BuckleModelWire[] {
  return pulled.models
    .filter((row) => row.origin.kind === "provider")
    .flatMap((row) => {
      const hop = hopRowOf(row, label, url);
      return hop === null ? [] : [hop];
    });
}

/** the catalog's SET accumulator — one row per model id, first
 *  admission wins. Factory-typed (the live-values idiom). */
function createModelSet() {
  const seen = new Set<string>();
  const models: BuckleModelWire[] = [];
  return {
    admit(rows: Iterable<BuckleModelWire>): void {
      for (const row of rows)
        if (!seen.has(row.id)) {
          seen.add(row.id);
          models.push(row);
        }
    },
    rows(): BuckleModelWire[] {
      return models;
    },
  };
}

/** one peer's contribution: pull its catalog through the seam, keep
 *  its direct rows re-originated. A dead or denied peer contributes
 *  nothing — its fault is logged at the seam, named, never swallowed. */
async function pullPeerRows(
  peer: BucklePeer,
  label: string,
  call: { tokenOf: TokenReader; traceparent: string; timeoutMs: number },
): Promise<BuckleModelWire[]> {
  const pulled = await peerJson(peer, {
    seam: "catalog.view",
    path: "/v1/models",
    schema: BuckleModelsResponse,
    tokenOf: call.tokenOf,
    timeoutMs: call.timeoutMs,
    traceparent: call.traceparent,
  });
  return pulled.ok ? directHopRowsOf(pulled.data, label, peer.url) : [];
}

export async function buildFederatedCatalog(ask: {
  settings: BuckleSettings;
  principal: string;
  tokenOf: TokenReader;
  traceparent: string;
  userToken?: string | null;
}): Promise<BuckleModelsResponse> {
  const { settings, principal, tokenOf, traceparent } = ask;
  const userToken = ask.userToken ?? null;
  const own = await buildCatalog(settings, traceparent, tokenOf, userToken);
  const admitted = admittedPeers(settings, principal);
  const set = createModelSet();

  // SET law precedence is deterministic: own rows win over peers
  // (never hop for what we serve), then peers in hubs-declaration order
  set.admit(own.models);
  for (const [label, peer] of Object.entries(settings.hubs ?? {})) {
    if (!admitted.includes(label)) continue;
    set.admit(
      await pullPeerRows(peer, label, {
        tokenOf,
        traceparent,
        timeoutMs: settings.timeouts.peer_pull_ms,
      }),
    );
  }
  return { hub: settings.hub.label, models: set.rows() };
}
