# Issue #42 — worker stats and optional lane transport

## Change and contract

- Azure's static JSON5 grant adds only `stats.read` to `worker@azure`.
  Principal/key identity, model grants, and secret paths are unchanged; no
  remint is needed. No admin, tree, or engine-passthrough scope is added.
- `x-session-id` and the existing `x-fleet-lane` lane header ride model hops,
  the engine leg, both BYOC carriers, and the generic engine relay. Values
  are opaque and optional, including empty strings. No ID is invented and
  no session/lane header grants access. Other internal headers keep their
  existing relay suppression. Existing context lane matching is unchanged
  except that an empty lane header no longer fails its optional fact schema.
- No outcome, ledger, OpenAPI, or client identity contract is expanded.
  Worker still owns stamping these headers via `before_provider_headers`.
- `bunfig.toml` now implements its already documented runner split: Playwright
  owns `*.spec.ts`, while Bun runs the existing `*.test.ts` migration suite.
  Both suites are explicitly discovered/run; no test is removed or weakened.

## Local proof (Bun 1.4.2)

- `bun install --frozen-lockfile`: passed; manifest/lock unchanged.
- `bun --bun playwright test --list`: all 18 new cases discovered in `unit`.
- `bun --bun playwright test --project=unit`: **18 passed**. Includes real
  hermetic HTTP worker-key stats 200/schema parsing, anonymous forged-header
  401, least-privilege scope assertions, hop + engine + direct/engine BYOC
  positive/absent/empty metadata, generic relay preservation, and streaming
  Messages byte identity. No Docker or live provider traffic in these tests.
- `bun test`: **150 passed**, 0 failures, 495 assertions.
- `bun run check`: laws hold (243 files, 0 warnings); OpenAPI in sync.
- `bun run typecheck`: blocked by four existing missing-`z` errors at
  `test/deploy/db/docker.fixture.ts:48–49` (unchanged by this patch).
- `qlty smells --all`: reviewed; touched test-kit finding is the existing
  `stubEngine` complexity (12), not a change in that function.
- `qlty check --all --filter eslint`: 11 existing findings, none in changed
  files. `qlty check --all --filter knip`: 25 existing findings; touched-kit
  finding is existing unused `WorldProvider`, not a new export. Initial
  plugin installs hit the root-owned `/tmp/.npm` cache; checks ran using a
  private `HOME` and lowercase `npm_config_cache`, without changing config.

## Live acceptance — pending authorized owner checkpoint

A read-only probe with the lane's mounted `/run/secrets/buckle_key` returned
**403** from `http://buckle:4111/v1/stats`:
`worker@azure lacks stats.read on this buckle`. This is a reproduction, not
proof that the candidate is deployed. The lane cannot access the Docker
socket (gid 122 is not in its groups) and has no authorized live settings
write/restart surface. No live configuration or service was changed.

After human review/merge, the serialized deployment owner should:

1. Rediscover the current VMSS instance, image digest, effective base/unit/
   over paths and grant precedence; preserve unrelated runtime settings.
2. Apply the reviewed JSON5 grant to the effective machine config and deploy
   the reviewed gateway image. Keep the existing worker key; do not put its
   value in commands committed here, logs, PRs or receipts. Unit config is
   loaded at boot, so follow the normal owner-controlled restart/drain path.
3. From the supervisor network, request `/v1/stats` with the existing mounted
   worker key. Record 200, schema-valid output and served revision. Confirm
   anonymous requests remain 401 and other worker scopes remain unchanged.
4. With an authorized GUI session, verify usage/requests panels receive and
   render live data. Do not claim this from a stats fixture alone.
5. After Worker's header extension is deployed, capture a lane request's
   actual stamped session/lane values at the gateway/peer boundary and
   confirm verbatim transport, plus a successful request without them.

This PR is diagnostic/draft until the live gate and repository qualification
are reviewed. Human merge checkpoint is mandatory; no auto-merge.
