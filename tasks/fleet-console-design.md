# Fleet Console — v1 design (one page)

Status: PROPOSED — no GUI code until the owner signs off. Issue #3 implementation
slices get minted only after this page is approved.

## Purpose

One screen to watch the autonomous fleet grind — tasks, lanes, PRs — inside the
console that already exists. **Read-only v1**: the operator keeps minting and
closing through the supervisor API; the GUI never mutates fleet state.

## What exists today (the seams this builds on)

- `deploy/gui/gui.main.ts` — the azure GUI shell: OIDC device-code front door
  (Entra), session cookie, `/api/*` proxied to buckle admin faces with the
  GUI principal key. `www/console.js` is the vanilla-JS view.
- Supervisor faces (compose-internal, :7780): `GET /board` → flat
  `{tasks, lanes, reports}`; `GET /watch` SSE (snapshot + deltas; #38 adds
  `task_graph`/`conversation` opts).
- No new server is added. The GUI learns one new upstream: `SUPERVISOR_URL`
  (default `http://supervisor:7780`, compose network, never published).

## Data flow

```
browser ──(OIDC session cookie)──► gui :7782
   gui ──(compose net, no auth v1)──► supervisor :7780  GET /board | GET /watch (SSE)
```

- `GET /api/fleet/board` → proxies `/board`, passes through `{tasks, lanes,
  reports}` as-is. One endpoint v1 — lanes and reports already ride `/board`.
- `GET /api/fleet/stream` → SSE proxy of `/watch` (v1.1; falls back to 10s
  polling of `/api/fleet/board` if the stream errors).
- Auth boundary: same OIDC gate as every other `/api/*`. The supervisor gains
  its fail-closed bearer (fw PR #40 follow-up) later — then the proxy adds one
  header; the design does not change.

## Screen (one screen, three bands)

1. **Board band** (top, always visible): rows = tasks · `id repo#issue title
   ST lane attN PR#n wall` — the supervisor's own glyphs and vocabulary
   (◐ working · ○ waiting · ✗ failed · ✓ done), no re-invention. PR number is
   a link to GitHub.
2. **Lanes band**: `clone-N` rows — current task, last seen (stale-cutoff
   highlight), claimed-at.
3. **Reports band** (collapsed by default): last 20 reports — settled, turns,
   in/out tokens, fence note (unchecked paths listed, `title` attribute full).

## States

loading · empty fleet ("no tasks — mint one") · supervisor unreachable
(banner + retry countdown, never a frozen table) · session expired
(redirect to login, existing behavior).

## Non-goals v1

No mutations (mint/close/requeue), no PR diffs (link out), no token-spend
history or charts, no per-lane drill-down, no mobile-specific layout.

## Implementation slices (minted only after approval)

1. `gui.main.ts`: `SUPERVISOR_URL` + `/api/fleet/board` proxy (+ unit test).
2. `www/console.js`: Board + Lanes bands, 10s poll (+ states).
3. Reports band + collapse.
4. `/api/fleet/stream` SSE + live updates (rides #38's `/watch` opts).
