# Issue #337 — fleet-buckle live functional audit

**Run:** 2026-11-26 UTC; source checkout `e64e9a9` (`main.ts` route table at that revision); live endpoints requested by brief `http://buckle:4111`, `http://engine:4000`. Responses below are direct `curl` requests. Authenticated probes used `/run/secrets/buckle_key` without disclosing it; it identifies `worker@azure`. Call this a functional audit, not a deployment qualification: live image/source provenance was not verified. Positive chat probes invoked upstream model `azure/gpt-5.4-nano` and emitted ordinary billable traffic; no further model calls are necessary.

## Summary

**Works on live stack:** open `/healthz`; authenticated `/v1/models`; `/metrics` Prometheus text; the three LLM dialects (chat completions, Anthropic messages, responses); SSE streaming; `/w/<slug>` prefix on model listing and chat; invalid model returns 404. Engine reachable directly. **Denied by current worker key:** stats, tree, all admin operations, and pass-through (403 by explicit scope guard). Thus the end-to-end positive behavior of those privileged faces is **unverified**, not a route malfunction finding. The requested key mint/hub edit and safe inspection of `/state/over.json5` could not be exercised. `#337` does not exist in `klh/fleet-buckle` or `klh/fleet` according to authenticated GitHub issue lookup; there was nowhere to post an issue clarification.

## Route table — observed live results

| Method + route | End-to-end result / evidence |
|---|---|
| `POST /v1/chat/completions` | **PASS (HTTP 200).** Bearer worker key; body model `azure/gpt-5.4-nano`; response was a proper OpenAI `chat.completion` with `audit337`, usage, and `x-fleet-buckle-served-by: azure`. Streaming variant returned HTTP 200, `text/event-stream`, multiple `data:` chunks and terminal `data: [DONE]`. `canary-chat` also reached buckle and engine, but returned HTTP 500 after 9.18s: LiteLLM could not resolve `canary-llm:8021` (`Name or service not known`); other unsuccessful attempt reported provider connection error. This is an upstream/engine model availability finding, not gate dispatch. |
| `POST /v1/messages` | **PASS (HTTP 200).** Same live model; returned Anthropic `message` response with text `audit337`; served-by header azure. A deliberately tried `canary-chat` attempt returned HTTP 500 with LiteLLM's unresolved `canary-llm:8021` error. |
| `POST /v1/responses` | **PASS (HTTP 200).** Same live model; returned `object: response`, completed output text `audit337`; served-by header azure. |
| `GET /v1/models` | **PASS (HTTP 200, 15,170-byte JSON).** Worker key lists 56 catalog rows, including own engine models and mscopilot rows (e.g. canary-chat). Same request without key: 401 `unauthenticated`. `/w/audit337/v1/models` also 200, same catalog. |
| `GET /v1/stats` | **BLOCKED (403), not end-to-end verified.** Live worker key authenticates as `worker@azure` but has no `stats.read`; exact response title `worker@azure lacks stats.read on this buckle`. Anonymous request returned 401. |
| `GET /v1/tree` | **BLOCKED (403), not end-to-end verified.** Exact response title `worker@azure lacks tree.read on this buckle`. Anonymous request returned 401. |
| `GET /healthz` | **PASS (HTTP 200, unauthenticated).** JSON `{ok:true,status:"up",label:"azure",trace_id:...}`. This matches the documented public readiness contract; it does not prove model/upstream readiness. |
| `GET /metrics` | **PASS (HTTP 200, unauthenticated).** `Content-Type: text/plain; version=0.0.4`. Valid Prometheus exposition, including `# TYPE buckle_requests_total counter`, per-model samples, `buckle_context_injections_total`, and `buckle_up{buckle="azure"} 1`. Counts increased after successful probes (e.g. `buckle_requests_total{...,model="azure/gpt-5.4-nano"} 5`). |
| `GET /admin/state` | **BLOCKED (403), not end-to-end verified.** Key lacks `admin`. Anonymous gets 401. No protected state was changed. |
| `POST /admin/keys` | **BLOCKED (403), not end-to-end verified.** Even request `{principal:"audit337-nonexistent"}` is rejected at the admin scope guard before parsing/operation; no key minted. |
| `POST /admin/hubs` | **BLOCKED (403), not end-to-end verified.** Even `{lanes:[]}` rejected at admin guard; no attempt to edit over file; no live settings swap verified. |
| Anything else → pass-through | **BLOCKED (403), not end-to-end verified.** `GET /health/liveliness?audit337=1` through buckle returned `application/problem+json`, kind forbidden, title `worker@azure lacks engine.passthrough on this buckle`. Anonymous returns 401. Direct engine `/health/liveliness` is HTTP 200 (`"I'm alive!"`), proving engine target/face is reachable, **not** that gate forwards it. Direct unauthenticated engine `/v1/models` is 401. |

## Lane/prefix observations

`GET /w/audit337/v1/models` returned HTTP 200 with catalog content. `POST /w/audit337/v1/chat/completions` returned HTTP 200 for `azure/gpt-5.4-nano`, response header `x-buckle-route: audit337`, served-by azure: path prefix is stripped for face routing and slug echoed as lane attribution. The two configured pinned lane IDs in `deploy/settings/azure.settings.json5` are `b3-gpt-consult` and `b3-repoagent-v1-calculon`; each pins to `claude-sonnet-5.5` (a BYOC seat). Without that lane's PAT those model IDs cannot be served here. A safe candidate body model `audit337-invalid-model` on `/w/b3-gpt-consult/v1/chat/completions` returned 404 naming `claude-sonnet-5.5` as unavailable, consistent with lane pin overriding the submitted model, but it did **not** prove a successful pinned upstream call. Do not send an invented PAT: BYOC requests relay credentials upstream.

A BYOC-shaped URL with a fake test token on a **non-BYOC** `azure/gpt-5.4-nano` chat returned 401 `a principal key is required for this model`, detail says URL token only admits BYOC providers. This exercises a valuable negative gate; it does not verify valid-PAT BYOC success. Tokens were not included in logs or report.

## Admin, federation, and passthrough limits

`deploy/settings/azure.settings.json5` grants `admin`, `stats.read`, `tree.read`, `engine.passthrough` to `gui@azure`; `worker@azure` only has `models.list` and `models.use`. The supplied mounted key is for the latter. Admin control tests at `src/admin/buckle.admin.control.test.ts` cover state, scope guard, key mint rules, and the `over`-file + live swap **in hermetic unit worlds**; those tests are not live proof for this Azure over file. No admin principal key/authority or disposable roster entry was provided, and `/state/over.json5` is not mounted into the audit workspace. Do not weaken scopes or probe alternate secrets to bypass authorization.

`GET /v1/tree` and `/v1/stats` outcomes are therefore conclusively **scope enforcement works**, but tree construction, peer federation, telemetry/cache body are untested live. Likewise, passthrough's guard works; unknown engine path reachability via the gateway is unverified. Direct engine liveness is independent evidence only.

## Non-route method behavior

`POST /healthz`, `/v1/models`, and `/metrics` with the worker key each return 403 for `engine.passthrough` rather than 404/405. This is dispatch by method+path: those POSTs miss the exact GET route and enter the protected catch-all. That is consistent with `routes[`${req.method} ${path}`] ?? passThroughFace`; determine separately whether clients/operators expect 405 on wrong-method known paths.

## Findings / severity

1. **P2 — Live canary model is not currently usable.** Three dialect requests for `canary-chat` reached the engine but failed HTTP 500 because LiteLLM reports unresolved `canary-llm:8021`; the available `azure/gpt-5.4-nano` passes. Evidence above. Engine/provider topology or canary health needs remediation if canary is an acceptance model.
2. **Unverified (not defect finding) — privileged faces and over-layer operations.** Worker key lacks scopes; no GUI/admin credential or safe disposable principal supplied. Positive `/admin/state`, one-time key mint, `/admin/hubs` write/live swap, `/v1/stats`, `/v1/tree`, and permitted unknown-path forwarding cannot be claimed. Provide a dedicated least-privilege audit principal/key and disposable over-file/test lane to repeat.
3. **Unverified (not defect finding) — configured BYOC lane successful pin.** A model pin is observed via deterministic 404 on uncredentialed seat; no PAT was supplied and fake tokens are correctly refused for non-BYOC model. Repeat only with operator-authorized test PAT and known live seat.
4. **Scope limitation — issue number absent.** GitHub API reports issue #337 not found in `klh/fleet-buckle` or `klh/fleet`; issue-specific discussion/closure cannot be made against the supplied repository issue.
