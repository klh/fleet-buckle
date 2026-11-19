# CLI verification: Copilot CLI + Claude Code via the `/w/` lane URL

Goal: both CLIs work against Buckle with **only the base URL changed**:

`https://fleet-buckle-klh.westeurope.cloudapp.azure.com:4111/w/<lane>/<key>/v1/...`

Status: **doc + curl recipe delivered; live CLI runs are OPERATOR steps**
(need the seat key and an interactive/TTY CLI). Nothing below was executed
by the author; the "Result" fields are to be filled in by the operator.

```bash
export BASE="https://fleet-buckle-klh.westeurope.cloudapp.azure.com:4111/w/<lane>/<key>"
```

## 1. Curl-level transcript (run first; no CLI needed)

```bash
# models
curl -sS "$BASE/v1/models" | head
# Anthropic Messages with a tool (what Claude Code sends)
curl -sS "$BASE/v1/messages" -H 'content-type: application/json' \
  -H 'anthropic-version: 2023-06-01' -H "authorization: Bearer <key>" -d '{
 "model":"<lane model>","max_tokens":256,
 "tools":[{"name":"get_time","description":"current time","input_schema":{"type":"object","properties":{}}}],
 "messages":[{"role":"user","content":"Call get_time."}]}'
# OpenAI chat with a tool (what Copilot CLI/BYOK sends)
curl -sS "$BASE/v1/chat/completions" -H 'content-type: application/json' \
  -H "authorization: Bearer <key>" -d '{
 "model":"<lane model>",
 "tools":[{"type":"function","function":{"name":"get_time","parameters":{"type":"object","properties":{}}}}],
 "messages":[{"role":"user","content":"Call get_time."}]}'
```
Expect `tool_use` / `tool_calls` in the reply. Paste output here: _TODO operator_.
Do not use forced `tool_choice` (seat rejects it; see byoc-verification.md).

## 2. Claude Code

```bash
export CLAUDE_CONFIG_DIR=$(mktemp -d)   # avoids headless keychain/OAuth hang
echo '{"hasCompletedOnboarding":true}' > "$CLAUDE_CONFIG_DIR/.claude.json"
export ANTHROPIC_BASE_URL="$BASE"       # no trailing /v1; CLI appends /v1/messages
export ANTHROPIC_AUTH_TOKEN="<key>"     # sent as Authorization: Bearer
claude -p 'Use the Bash tool to run `date`, then report the output.'
```
Pin a lane model that supports `/v1/messages` (e.g. a Claude model; a
Responses-only model yields "no model endpoints available"). Result: _TODO operator_.

## 3. Copilot CLI

Copilot CLI BYOK/provider-override env (names per current CLI release; verify
with `copilot --help` / docs for your version):

```bash
export COPILOT_PROVIDER_BASE_URL="$BASE/v1"
export COPILOT_PROVIDER_TYPE=openai
export COPILOT_PROVIDER_API_KEY="<key>"
export COPILOT_MODEL="<lane model>"
copilot -p 'Run `date` with your shell tool and report the output.' --allow-all-tools
```
Result: _TODO operator_ (confirm exact env names; they are unverified here).

## 4. Wire gaps / headers the seat may 400

Known from prior live runs (byoc-verification.md); extend after operator runs:
- Lane pin overrides the body `model`; wrong model-to-surface pairing gives
  `no model endpoints available given user constraints` (not an auth error).
- Forced `tool_choice` is rejected by the seat (model constraint).
- Copilot integration headers (`catalog_headers`) are injected by Buckle on
  both BYOC carriers; clients should not need to send them.
- Candidates to check when a CLI 400s: `anthropic-beta` values, `x-stainless-*`,
  `copilot-integration-id`, `editor-version`, unknown body fields (e.g.
  `context_management`, `cache_control` scopes). Capture with
  `ANTHROPIC_LOG=debug` / a request-logging proxy and record the offending
  header here: _TODO operator_.
- Key rides in the URL; keep it out of logs and shell history.
