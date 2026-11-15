# BYOC engine verification — buckle serves MS Copilot

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
