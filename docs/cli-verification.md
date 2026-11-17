# CLI verification — Copilot CLI + claude against the `/w/` lane URL

Issue #4. Goal: an operator points an existing agent CLI at buckle by
changing ONLY the base URL:
`https://fleet-buckle-klh.westeurope.cloudapp.azure.com:4111/w/<lane>/<key>/v1/...`

## Status

| CLI | Status |
|---|---|
| `claude` (Claude Code) | Verified 2026-11-17 for a text turn, see `docs/byoc-verification.md` P0.2c. A tool-using turn was shown by curl+SSE only, **not** by the CLI itself. |
| `copilot` (Copilot CLI) | **Not yet verified.** |

This file was written from a workspace that has neither CLI installed nor a
Copilot PAT, so no live run was possible. Acceptance ("both CLIs complete one
real tool-using turn") is **not met** until the runs below are done and recorded.

## claude — env

```bash
PAT=<github copilot PAT>
export CLAUDE_CONFIG_DIR=$(mktemp -d)
echo '{"hasCompletedOnboarding":true}' > "$CLAUDE_CONFIG_DIR/.claude.json"
export ANTHROPIC_BASE_URL="https://fleet-buckle-klh.westeurope.cloudapp.azure.com:4111/w/<lane>/$PAT"
export ANTHROPIC_AUTH_TOKEN="$PAT"
claude -p 'Use the Bash tool to run `echo wire-ok`, then report its output'
```

Notes:
- Pin a messages-capable model on the lane. A Responses-only pin gives
  "no model endpoints available given user constraints".
- A fresh `CLAUDE_CONFIG_DIR` is needed headless, or the run hangs before any HTTP.
- The seat rejects forced `tool_choice` (model constraint).
- `mcp_servers` stripping is handled at the buckle layer (W2594).

## copilot — to run

Set the Copilot CLI's provider/base URL to the lane URL
(`.../w/<lane>/<PAT>/v1`) and run one prompt that needs a tool call. Record:
CLI version, exact env/config keys, which wire legs it used
(`/v1/chat/completions`, `/v1/responses`, `/v1/messages`), any headers the seat
400s, and the final transcript.

## Wire gaps found

None recorded yet from live CLI runs.
