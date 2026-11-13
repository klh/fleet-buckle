# keys/

Fixture key files for the demo topology. The test kit (`test/kit`)
generates them at compose-up time into `.gen/` (gitignored); this folder
ships only README and the mount contract: settings reference key files
strictly by PATH (`/etc/buckle/keys/...`), values never ride artifacts.

- `root.key`  — each buckle's own root key
- `openrouter.key`, `mscopilot.key`, `zai.key` — provider fixture keys
- `peer-b2.token`, `peer-b3.token` — federation pull tokens
- `alice.key`, `bob.key`, `carol.key`, `agent-07.key` — principal keys
