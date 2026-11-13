# Test flow — the plan tests follow, in order

Step by step, test by test: every step writes its FAILING tests first,
then the smallest implementation that passes them. No file outside the
established capability folders; no organization drift.

## Fixtures are REAL captures — never hand-typed

The stub catalogs (`test/deploy/fixtures/*.models.json`) are slices of the
providers' REAL `/v1/models` responses, captured by
`bun tools/src/buckle.capture-fixtures.ts` (keys are machine-local
paths, never committed). Refresh whenever the demo should ride new
reality. From those fixtures, `bun tools/src/buckle.gen-engine-config.ts`
generates the litellm engine configs (`test/deploy/engine/*.litellm.yaml`,
gitignored): every catalog row becomes a deployment under its REAL id —
engine and catalog can never drift, and the generator runs in the
playwright global-setup, so the stack always boots consistent.

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
   round trip through litellm→stub (generated engine config), /metrics
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

## Stage 0 — the standing first-stage demo (`test/deploy/compose.stage0.yaml`)

The stack's first smoke moment, kept forever: stubs + the three buckles
+ sidecars, NO engines. The minimal buckle ANSWERS (`/healthz` — label
per hub), so the sidecars swear all three `up` (the smoke that should
NOT fail works); a chat round trip is honestly red — 503
`application/problem+json` (the smoke that should fail, fails).
Host ports 49xx; runs beside the full 47xx stack in one pass.

## Rolling deploy (`test/deploy/compose.rolling.yaml` + `deploy/front/`)

The architecture that makes a new buckle version swappable with zero
downtime: a per-unit FRONT (tiny reverse proxy) — the active upstream
is a STATE FILE, read per request. The switch is a same-inode write
into the mounted `test/deploy/roll/` directory (a host-side rename replaces
the inode and VirtioFS never shows it; the front's last-known-good
makes a torn read harmless — it serves the previous version until a
clean read lands).

The rolling spec proves the sequence:
1. v1 serves through the front (`x-buckle-upstream` observable)
2. the unit-surface sidecar (polling the FRONT) is up — the contract
3. the NEW version gates healthy BEFORE traffic flips: its own
   sidecar swears it up, and its `hub.version` stamp ("v2-rolling")
   answers on healthz while v1 still serves
4. THE SWITCH under load: a v1 stream (all 200/upstream=v1) → one
   state write → the stream continues all-200/upstream=v2, the version
   stamp visible THROUGH the front, and the unit sidecar never went
   down — no dropped request
5. drain: v1 stops; chats keep riding v2; the front never blinked
