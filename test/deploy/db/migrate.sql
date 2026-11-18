-- Worker-side migration (run as fleet_worker's owner in db fleet_worker). Guarded:
-- advisory lock serialises runners, ledger makes re-runs no-ops.
SELECT pg_advisory_lock(727001);
CREATE TABLE IF NOT EXISTS schema_migrations(id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE id='0001_worker_tasks') THEN
    CREATE TABLE worker_tasks(id serial PRIMARY KEY, body text NOT NULL);
    INSERT INTO schema_migrations(id) VALUES ('0001_worker_tasks');
  END IF;
END $$;
SELECT pg_advisory_unlock(727001);
