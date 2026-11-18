# Lens VMSS live receipt (B07) — STATUS: BLOCKED / NOT DEPLOYED

No traces were stored and no investigation was run; nothing below is claimed beyond what was checked.

## Checked (supervisor seat)
- Docker Engine 29.1.3 reachable via /var/run/docker.sock; hub containers (buckle-*, w17pg etc.) running and left untouched. No Lens containers created.
- ClickHouse digest resolved from Docker Hub: `clickhouse/clickhouse-server:24.8` -> `clickhouse/clickhouse-server@sha256:1ffa82edee000a42c09313bd9f1293d94c570aee74babc1b3ca9983a35fa597b` (index digest; candidate CLICKHOUSE_IMAGE, not yet booted).
- Lens image: the LiteLLM docs ("Set up Lens": "The local quickstart builds from source. See Releases and images") give no published pinned image I could resolve. LENS_IMAGE digest is UNRESOLVED.
- No LENS_*/LITELLM_* secrets exist in this seat's environment (LENS_ADMIN_TOKEN, LENS_TRACE_KEY, LENS_CLICKHOUSE_PASSWORD, LENS_ANALYSIS_MODEL must be supplied by the owner, e.g. in lens.env outside the repo).

## Acceptance status
1 pinned boot: blocked (Lens digest). 2 trace via buckle:4111: not run. 3 retention/access: config in clickhouse-retention.xml / compose (loopback 127.0.0.1:4318, internal lens-private network) unvalidated live. 4 investigation: not run. 5 digests/ports/creds/rollback: below.

## Planned ports / credentials / rollback
- Ports: 127.0.0.1:4318 OTLP/HTTP only. Credentials: paths only, `lens.env` (mode 0600, outside git).
- Rollback: `docker compose -f deploy/compose.yaml -f deploy/lens/compose.lens.yaml down lens lens-clickhouse` (stops only Lens services; hub unaffected; volumes lens-ch-data/lens-backup kept unless `-v`).

## Unblock needs
A published/built Lens image digest (or approval to build from source and push to a registry), plus the secrets above.
