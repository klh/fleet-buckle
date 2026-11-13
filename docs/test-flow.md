# Test flow — the plan tests follow, in order

Step by step, test by test: every step writes its FAILING tests first,
then the smallest implementation that passes them. No file outside the
established capability folders; no organization drift.

## Commit 3 — "the wire" (server: healthz → catalog → forward)

1. **healthz face** (unit `src/server/buckle.server.main.test.ts`):
   boot with merged settings → `GET /healthz` parses as BuckleHealthz
   `{ok:true, status:"up", label, trace_id}`.
2. **catalog** (unit `src/server/buckle.server.models.test.ts`): a
   stub provider serves fixture rows → `GET /v1/models` returns rows
   mapped through BuckleModelWire — bare ids pass, FULL provider
   metadata rides verbatim (never fabricated), origin says which
   provider. Peers (buckle-origin rows) are NOT here — they are
   commit 4's tests (federation), added when peers serve catalogs.
3. **MITM forward** (unit `src/server/buckle.server.forward.test.ts`):
   `POST /v1/chat/completions` forwards to the engine; the W3C
   traceparent CONTINUES onto the engine request (asserted by an
   echo stub); unknown model → problem+json; `/metrics` counters bump
   per request (Prometheus text).
4. **docker e2e** (`test/e2e/buckle.e2e.wire.spec.ts`): the REAL stack
   — each buckle: healthz 200, its provider's catalog rows, one chat
   round trip through litellm→stub (OPENAI_API_BASE wiring), /metrics
   reflects the traffic.
5. **smoke flip** (`test/smoke`): c) goes from ALL UNHEALTHY to
   all `up` — the LAST change, only after the wire truly serves.

## Commit 4 — access + federation (same rhythm)

principals/keys → grants matrix (alice/bob/carol) → stats → tree
(peers pull downstream catalogs) → e2e matrix spec activates (it rides
behind the server today, skipped).

## Commit 5 — the full demo matrix green in Docker

the demo matrix curls as spec: grants per principal per buckle, denial
paths 403 problem+json, federation tree depth-2 summaries, load waves.
