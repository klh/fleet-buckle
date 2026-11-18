# Lens deployment (B07)
Lens is early access. Pinned versions (record at rollout): LENS_IMAGE=`<repo>@sha256:<digest>`, CLICKHOUSE_IMAGE=`<repo>@sha256:<digest>`. Compose refuses to start unset.

## Shared compose patch (integration lane)
Add `-f deploy/compose.compose.lens/compose.lens.yaml` to the compose invocation. Worker env: `OTEL_EXPORTER_OTLP_ENDPOINT=http://lens:4318`, `OTEL_EXPORTER_OTLP_HEADERS=x-lens-trace-key=$LENS_TRACE_KEY` (W14 Pi spans carry fleet.* attributes). LiteLLM: add Lens connection in dashboard with admin token (admin only).

## Validate
`docker compose -f deploy/compose.yaml -f deploy/compose.compose.lens/compose.lens.yaml config -q` (with env set).

## Backup restore
`docker compose exec lens-clickhouse clickhouse-client -q "BACKUP DATABASE lens TO File('/backups/b.zip')"`; restore with `RESTORE DATABASE lens FROM File('/backups/b.zip')`.

## Rollback
Remove the `-f` fragment and `docker compose up -d`; volumes retained. Revert to previous digest to downgrade.

## Live receipt: SKIPPED (no docker in this worker)
On the VMSS/supervisor: set env, `docker compose ... up -d lens lens-clickhouse`, run one Pi call, then query Lens for the trace by fleet.submission_id, match litellm.call_id in LiteLLM spend, run one investigation and verify redaction. Lens traces are diagnostic; Pi journal stays authority.
