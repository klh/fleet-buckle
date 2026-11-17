# BYOC engine verification — buckle serves MS Copilot

**Scope:** this records the earlier BYOC/GUI test topology. For the
Azure organization rollout, follow `tasks/plan.md`: APIM validates the
Entra user on the **model wire**, forwards identity/token to Buckle,
and each client supplies its own Copilot PAT in the URL lane or Bearer
header. Bearer-PAT requests carry Entra in a separate APIM-validated
header; neither carrier is a substitute for Entra admission.
The GUI-only OIDC test below does not prove that APIM boundary or
LiteLLM per-user attribution.
The organization path also requires a local, model-independent Entra
login helper and APIM preflight before Claude Code starts; a GUI MFA
test cannot substitute for that CLI bootstrap.

The MVP test, in one sentence: **the Copilot CLI/TUI just works when the only
thing that changes is the URL** — `https://api.githubcopilot.com` becomes
`http://<hub>/w/copilot/<token>/v1` — full live catalog, chats and streams,
with Entra MFA on the front door and litellm in the middle.

## The chain (what "serving mscopilot" means here)

```
dev (Copilot CLI, own PAT in the URL)
  → /w/copilot/<token>/v1 on buckle      (BYOC: token relayed, never stored)
  → litellm (the engine)                 (keyless deployment for the seat:
                                           forwards the CALLER's api_key;
                                           copilot-integration-id rides the
                                           deployment's extra_headers)
  → api.githubcopilot.com                (sees the dev's own credential)
```

- buckle is the ONLY thing the dev talks to; buckle SERVES the seat's models.
- No unit key ever exists for a `user_token` seat — the registry default.
- Catalog = the seat's LIVE `/models`, verbatim, all rows (no caps, no
  hardcoded ids); warmed per dev token, seat-wide cached, honest-cold.
- Generic throughout: any engine, any OIDC IdP, any user_token provider.
  Nothing IKEA/Azure/tenant-specific in this repo; VMSS hosting is ad-hoc
  `az` at deploy time (NO bicep — compose is the product artifact).

## Waves

1. **Engine-first BYOC leg (hermetic)** — `userChat` rides the unit's engine
   when one is configured (caller token AS the engine Authorization; ungated
   engine on the isolated unit network), direct relay otherwise. Unit tests
   cover BOTH carriers.
2. **Keyless engine legs** — the config generator emits, for `user_token`
   providers: `openai/<id>` at the real seat base, NO api_key,
   `extra_headers` from the registry, `drop_params`, no master_key gate.
   Azure stacks (real + test) gain the litellm engine service; e2e proves
   the token arrives at the seat THROUGH litellm.
3. **OIDC front door (GUI)** — generic device-code login: issuer+client env
   (Entra = one issuer string), id_token verified against the IdP JWKS
   (RS256 via node:crypto, no new deps), HMAC session cookie, and `/api/*`
   requires the session. Hermetic e2e against a stub IdP.
4. **VMSS deploy (ad-hoc az)** — 1-instance VMSS, docker via cloud-init,
   repo tarball shipped, keys minted ON the hub, Entra app registration,
   verify from here: healthz → GUI MFA login → Copilot CLI against
   `/w/copilot/<token>/v1` (models + chat round trip).
5. **Landing** — openapi regen, qlty, laws, full suites, one commit.

## Explicitly out (backlog)

- Streaming chunk-passthrough (the leg is body-verbatim; buffered SSE is
  MVP-acceptable — upgrade to a streaming seam if the CLI UX demands).
- Mixed gated+BYOC units on one engine (litellm virtual keys).
- Two-segment `/w/<hub>/<seat>` lanes.

## P0.2c — unmodified Claude Code on the Azure /w/ wire (2026-11-17)

Chain: `claude` CLI (2.1.312) → buckle `:4111/w/b3-gpt-consult/<PAT>/v1/messages`
→ engine byoc pass-through (`/v1/byoc/mscopilot/v1/messages`, litellm
1.103.0) → MS Copilot seat → `claude-sonnet-5.5`.

```bash
PAT=<github copilot PAT>   # the seat token, rides the URL — BYOC law
export CLAUDE_CONFIG_DIR=$(mktemp -d)          # headless hang fix, see below
echo '{"hasCompletedOnboarding":true}' > "$CLAUDE_CONFIG_DIR/.claude.json"
export ANTHROPIC_BASE_URL="http://fleet-buckle-klh.westeurope.cloudapp.azure.com:4111/w/b3-gpt-consult/$PAT"
export ANTHROPIC_AUTH_TOKEN="$PAT"
claude -p 'Reply with exactly: wire ok'        # → wire ok, exit 0
```

Curl proof of the same wire with tools + SSE (streamed `tool_use`
block; the seat itself rejects forced `tool_choice`, which is a model
constraint, not a wire defect):

```bash
curl -N "…/w/b3-gpt-consult/$PAT/v1/messages" \
  -H "authorization: Bearer $PAT" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" -d @tools-stream.json
```

Two lessons the live run taught:

1. **The lane pin overrides the body model.** A lane pinned to a
   Responses-only model (`gpt-6.1-terra`) answers `/v1/messages` with
   Copilot's `no model endpoints available given user constraints` —
   that error names a MODEL-TO-SURFACE mismatch, not auth. Pin
   messages-capable models for CLI lanes (the live lane was repinned
   to `claude-sonnet-5.5` via `POST /admin/hubs`).
2. **Headless CLI runs hang on the default config dir** — its
   keychain/OAuth touch blocks a no-TTY `-p` run before any HTTP
   leaves the machine. A fresh `CLAUDE_CONFIG_DIR` with
   `{"hasCompletedOnboarding":true}` rides clean.

Registry `catalog_headers` (the Copilot integration id) now ride BOTH
BYOC carriers — direct and engine pass-through (commit 0fa5f67), even
though the engine's pass-through row also pins them statically:
belt-and-braces, unit-tested on both branches.
