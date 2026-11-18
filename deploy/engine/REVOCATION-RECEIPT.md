# B04.1 revocation receipt — real ingress, throwaway container of the new image

Probe: `test/deploy/probe/revocation.probe.spec.ts` (+ `revocation.settings.json5`).
Run: `bun --bun playwright test -c <config with testDir=test/deploy/probe>`
(the spec lives under test/deploy, outside the repo's default projects).
Needs only the docker socket (Engine API via fetch; no docker CLI).

## Build (STEP 0)
- Source: main @ b814c4b (includes #29 revocation fix f290e1d)
- Image `buckle:b814c4b-probe` = `sha256:47d1817970d526b6fd20c2172444e847db7fd9c251159cd570c501abf9afd3d0`
  (built through the Engine API `/build`; repo Dockerfile)
- Stub provider image `probe-stub:local` = `sha256:7397a7467498f520782bfd27191e08c7026a6451ed0625d09a5138f78a19deeb`
- RUNNING build compared: `buckle:807cf85` = `sha256:a6f0ca3193f77465a0af7b8dfca96326623b9fdff72186ec37ae0c2ab7bc9ee2` (predates #29)
- The running `buckle-buckle-1` was NOT touched (compose swap is reserved).

## Probe (throwaway container on `buckle_default`, removed afterwards)
1. admin key seeded; mint `victim@probe` and `bystander@probe` via `POST /admin/keys` (201)
2. BEFORE: victim and bystander `GET /v1/models` 200, `POST /v1/chat/completions` 200
3. REVOKE: `revoked:true` row for the victim lands in the over layer, then
   `POST /admin/hubs {}` (admin reload seam) swaps live settings. buckle has no
   dedicated revoke endpoint; this is the revocation path the admin API offers.
4. AFTER (immediately): victim `/v1/models` 401, `/v1/chat/completions` 401; bystander still 200 / 200.

## Receipt (run 2026-11-18, new image)
| key | value |
|---|---|
| victim key id | `bksk_jmO9…` (victim@probe) |
| bystander key id | `bksk_ixLB…` (bystander@probe) |
| minted | 2026-11-18T13:07:38.818Z |
| before | 2026-11-18T13:07:38.843Z — 200/200/200/200 |
| revoked | 2026-11-18T13:07:38.861Z |
| after | 2026-11-18T13:07:38.868Z — victim 401/401, bystander 200/200 |

Control: the same probe against `buckle:807cf85` fails (victim not cleanly denied; got a 500 on the
after-step), i.e. the old running build does not meet the acceptance.

## Request
Integration lane: please swap the compose `buckle` service to image
`sha256:47d1817970d526b6fd20c2172444e847db7fd9c251159cd570c501abf9afd3d0`
(or a rebuild of main ≥ b814c4b), then re-run the probe against the running container.
