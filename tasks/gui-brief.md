# GUI brief — a uniform, layered console (draft-anchor for ChatGPT)

Owner directive (2026-11-17): a *somewhat simple* GUI for the Azure
stack. Do NOT bring over suspenders/belt — combining GUI with the
orchestration layer was a mistake. The GUI must be **uniform and
easily extensible with new options and layers**. ChatGPT produces the
initial draft; this brief is the contract the draft is reviewed
against.

## Architecture law (the one thing that must not be violated)

**The GUI is a thin, read-mostly face over HTTP APIs.** It never
imports orchestration code, never opens sqlite, never touches docker.
Every data source is a **layer**: a declared unit the console mounts
uniformly. Adding a layer = adding a descriptor + renderer, never
editing core wiring. That is the whole point.

## What exists to build on

- `deploy/gui/` — the console front door ALREADY in the VMSS compose:
  `gui.main.ts` (Bun serve + session cookie), `gui.oidc.ts` (Entra
  MFA device flow), `gui.session.ts`, `www/console.ts|css|index.html`.
  It already proxies buckle admin calls with the admin key server-side.
- Supervisor HTTP (in-network `supervisor:7780`): `GET /board` →
  `{ tasks: [{id, repo, kind, issue, state, lane, pr, attempts,
  leaseUntil}], reports: [{task_id, settled, pr, turns, in_tok,
  out_tok, wall_ms, note}], lanes: [...] }`; `POST /cancel
  {"taskId": N}` → `{"ok": true}` (admin cancel is the ONLY write
  path v1 needs).
- Buckle HTTP (in-network `buckle:4111`): `GET /admin/hubs` (Bearer
  admin key, server-side), `POST /admin/hubs` (lane repin),
  `GET /v1/models` (principal bearer), `GET /healthz`.
- Health sidecars: per-service `*/health` verdict ports.

## Required shape

- **Client**: vanilla TypeScript + DOM APIs, compiled like the current
  `console.ts`. **NEVER `innerHTML`**, never `document.write`. CSS
  custom properties (tokens) for all colors/spacing; no CSS framework,
  no JS framework, no CDN, no new runtime deps.
- **Layer registry** (the uniform core):

  ```ts
  type Layer = {
    id: string; title: string;
    pollMs: number;                      // per-layer cadence
    fetch: () => Promise<unknown>;       // one read path
    render: (el: HTMLElement, data: unknown) => void; // uniform panels
    actions?: Action[];                  // optional declared writes
  };
  type Action = { id: string; label: string; invoke: (input: string) => Promise<void> };
  ```

  The console: mounts each layer as a collapsible panel, one shared
  poll loop honoring `pollMs`, per-layer error banner on fetch failure
  (degrade that panel, never the page), and a single action bar per
  panel rendering declared actions.
- **Server**: one generic proxy in `gui.main.ts` per backing service
  (`/api/supervisor/*` → `supervisor:7780`, existing buckle admin
  proxy stays). Credentials NEVER reach the browser.

## Layers for v1 (in this order)

1. **Fleet tasks** — supervisor `/board`: tasks table (id, issue+repo,
   state glyph, lane, PR link, attempts, lease countdown) + latest
   report line (turns/tokens/wall); action: cancel by task id.
2. **Buckle lanes & models** — `/admin/hubs` + `/v1/models`: lane
   table (name, pinned model, upstream), model list; read-only v1.
3. **Health** — `*/health` verdicts as a status row (up/degraded/down
   glyph + word, never color alone).

Deliberately NOT v1: minting issues, key admin, trials analytics,
anything requiring more than the one cancel write.

## Review criteria for the draft

- No `innerHTML`/`document.write`; DOM built with createElement/textContent.
- Every panel is a Layer instance — no bespoke wiring per panel.
- A dead backing service degrades one panel, not the page.
- Tokens only (no hardcoded colors); glyph+word status, not color alone.
- Zero new runtime dependencies; single poll loop; actions are
  declared, confirmed (one confirm() is fine), and optimistic-refresh.
