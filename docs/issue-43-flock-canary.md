# Flock canary recovery (#43) — demotion candidate, not a live release

The VMSS canary receipt in the Belt README is **not** proof of a canary on
`flock-runner-0`. On 2026-11-27, from the isolated lane on the live network:
`GET buckle:4111/v1/models` (worker key) returned 200, 56 rows, including
`canary-chat`; a single `max_tokens:1` chat on the same gateway returned 500
after 8.57s with an upstream connection error. `engine:4000/health/liveliness`
returned 200, not proof of canary readiness. Prior live audit
[issue-337](issue-337-live-functional-audit.md) reports the engine could not
resolve `canary-llm:8021`. This lane cannot reach the Docker socket (permission
denied) and has no Azure CLI/SSH, GUI credential, host config, pinned Belt
image or pinned GGUF. No deployment was changed. **Do not mark the chat or
Belt acceptance green on this evidence.**

## Integration owner: deploy Belt if the immutable artifacts are available

1. Inventory the effective flock Compose, engine config, served image digest,
   mounted secrets and Belt release manifest (not the old VMSS). Obtain a
   pinned llama.cpp image digest, exact Qwen3-0.6B GGUF hash/revision, Belt
   profile and independent readiness receipt from the Belt owner. Belt
   `profiles/vmss-canary-chat.example.json` has `enabled:false` and is an
   example, **not** a release manifest. Do not blindly copy it or build Belt
   from a sibling checkout. Keep the model bind private; never publish :8021.
2. Deploy through the integration owner: canary server + immutable model
   artifact beside engine, then Belt outside-process probe `/health` **and**
   representative chat inference, then wire the rendered `canary-chat` row to
   the engine, restart/reload the engine, verify revision. Do not add a new
   Buckle provider or use the exhausted Copilot seat for this smoke.
3. With authorized GUI credential, prove the GUI playground POST
   `/api/chat.json` responds to a 1-token prompt and the gateway response
   has nonempty content. Check engine/gateway catalog and a denied/absent
   route; save HTTP status, request/trace IDs, served revisions and Belt probe
   receipt (no secrets). Roll back to the original engine config and restart
   if either probe fails. Link fleet-worker#256 `gateway-503-burst` receipt
   separately; this gateway deployment cannot claim to have implemented E1.

## Bounded fallback: remove the broken alias until Belt is healthy

If pinned artifacts or server capacity are unavailable, **first** back up
and hash the effective *off-repo* engine YAML. On the authorized deployment
host (not in this agent workspace), with Bun 1.4+ and this repo's source:

```sh
umask 077
bun tools/src/buckle.demote-engine-model.ts /path/to/effective-engine.yaml /path/to/new-candidate.yaml canary-chat
```

The tool validates the existing `model_list`, removes **all** rows named
exactly `canary-chat`, preserves unrelated engine settings (including BYOC
pass-through), and refuses absent rows, an empty remaining catalog, malformed
input or an existing output path. It creates only a new 0600 candidate. It
never writes an active file or prints config. **Review the full diff privately**:
check for router aliases/references or other advertised rows with unhealthy
upstreams, verify existing env/keys and engine version, then use the normal
atomic rollout/restart path for this host. The source is the *effective*
artifact, not the repo's generated example from the old deployment. If the
engine config is regenerated, propagate this demotion into that generation
source, or the dead row will return on restart. Restore the hashed backup to
roll back. Do not silence Buckle errors or filter only its catalog: the
engine must cease advertising the route itself.

After deployment, verify `GET /v1/models` on engine and Buckle omits
`canary-chat`, check the still-healthy twin completion (authorized,
`max_tokens:1`), and check that the GUI no longer offers the dead canary.
The original full-wire GUI→Belt acceptance stays blocked until Belt is
actually deployed; the fallback only restores catalog honesty. The
cross-repo event-plane acceptance remains open on fleet-worker#256.

## Local proof (candidate tooling only)

- `bun --bun playwright test --list`: 66 tests, 15 files; new specs discovered
  only in `unit`. `--project=unit`: 4/4 pass (alias removal/config retention,
  refusal cases, private/exclusive candidate, parser-error redaction).
- `bun test $(git ls-files '*.test.ts')`: 150/150 legacy tests pass. Plain
  `bun test` also discovers the new Playwright spec and errors because it
  is not a Bun suite; use the explicitly separated runners above.
- `bun run check`: laws hold; OpenAPI unchanged/in sync.
- `bun run typecheck`: blocked by existing missing `z` imports in
  `test/deploy/db/docker.fixture.ts:48–49`; no changed-file errors.
- `qlty smells --all`: exit 0, no findings in changed code. Qlty eslint/knip
  installation blocked by root-owned `/tmp/.npm` cache (exit 99).
  Installed ESLint on changed TypeScript: clean. `bunx --bun knip@5.88.1`:
  existing unused dependency/export backlog only, no changed-file findings.

These checks do not qualify a live deployment. Owner/integration must record
engine/catalog revision and GUI/Belt/event receipts before closing #43.
