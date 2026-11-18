# B02 database lifecycle qualification receipt

Pinned image: `ghcr.io/berriai/litellm@sha256:bd089afdcd35b894b14a93f9743cdc8b591f82da1a38dd43a010a7b0c9de5fd7` (v1.103.0), `postgres:16` (16.16), throwaway containers on a private docker network, driven over `/var/run/docker.sock`.

Command (VMSS supervisor seat; ~1.8 min):

    bun install --frozen-lockfile
    bunx playwright test -c test/deploy/db/db.playwright.config.ts
    # 4 passed (1.8m)

Files: `test/deploy/db/{db-lifecycle.spec.ts,roles.sql,migrate.sql,docker.fixture.ts}` (+ standalone `db.playwright.config.ts`; it has no stack dependency).
Scope limit: hermetic fixture (fake upstream model, one virtual key); not the Azure live deployment receipt.

## 1. Migration once + idempotent guard — PASS
- `roles.sql` run twice: no error, exactly 2 roles (`CREATE ROLE`/`CREATE DATABASE` guarded by catalog checks).
- `migrate.sql` (worker DB) run 3x: advisory lock + `schema_migrations` ledger; ledger row count for `0001_worker_tasks` = 1.
- Engine: first boot ran `prisma migrate deploy` → 184 finished rows in `_prisma_migrations`; stop/start → still 184, none re-applied.
- Operational note: LiteLLM migrates on boot, so with several replicas run the migration from ONE job/replica first (or use the prod guide's disable-schema-update flag on the rest). Not exercised multi-replica here.

## 2. Role separation — PASS
- `fleet_worker` → db `litellm`: `FATAL: permission denied for database "litellm" / User does not have CONNECT privilege.`
- `litellm_engine` → db `fleet_worker`: `FATAL: permission denied for database "fleet_worker"`.
- Defence in depth: with CONNECT deliberately granted to `fleet_worker`, `select * from "LiteLLM_VerificationToken"` → `ERROR: permission denied for table LiteLLM_VerificationToken`. (CONNECT revoked again.)
- Positive controls: each role reads its own tables.

## 3. Backup = pg_dump round-trip — PASS
`pg_dump -U litellm_engine -d litellm --no-owner -Fp` (195264 bytes) restored with psql into new db `litellm_restore`; token count 1 = 1 and md5 over sorted token hashes identical (`79a8c02b…`). Restore of keys is by hash; see §5 for the salt.

## 4. DB outage behavior of the pinned image — RECORDED (observed, not assumed)
Probes via inside-container HTTP, no upstream (model api_base is dead, so chat 500 "Connection error" is upstream, not auth). Postgres stopped 3 s before the "down" probe.

| probe | DB up | DB stopped | DB back |
|---|---|---|---|
| `/health/readiness` | 200 `db: connected` | **200 `db: connected`** | 200 |
| previously-seen (cached) virtual key `/v1/models` | 200 | **200** | 200 |
| never-seen key `/v1/models` | 401 token_not_found | **503 `no_db_connection` "authentication database is temporarily unreachable"** | 401 |
| master key `/v1/models` | 200 | 200 | 200 |

Honest conclusions:
- In this config the pinned image did NOT admit an unverifiable key under a restricted INTERNAL_USER identity: an uncached key fails closed with 503. I did not reproduce the guide's restricted-INTERNAL_USER admission (it may depend on other settings, e.g. `allow_requests_on_db_unavailable`, which is not set here and must stay unset).
- Not fail-closed: readiness stays 200/"connected" while the DB is down, and a key already in the engine's auth cache keeps being admitted for the cache lifetime (probe was seconds after the stop). So **a revocation or budget change made during an outage does not take effect on cached keys**, and readiness must not be used as an authorization signal.
- Buckle contract: remote worker/coordinator requests are denied unless the engine answers an authenticated scoped probe; the outside probe must send a scoped positive and a negative request (as in the spec), not `/health/readiness`. Treat 503 `no_db_connection` as deny/retry. Not tested here: Redis loss, multi-replica, cache-TTL expiry during a long outage, budget enforcement under outage (left to B02.2/B14).

## 5. Salt-key preservation
`LITELLM_SALT_KEY` (`sk-b02-salt-key` in the fixture) encrypts provider credentials stored in the DB; a pg_dump alone is not restorable to a usable state without it, and changing it makes stored credentials unreadable. Back up the salt together with, but stored separately from, each dump (secret store, same retention), set it explicitly on every replica, and never rotate it casually. Virtual keys are stored as hashes and survive in the dump regardless. Not tested: decrypting a stored credential with a wrong salt (fixture stores no provider credential, YAML owns models).
