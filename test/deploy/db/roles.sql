-- B02 role split. Run as the postgres superuser; every statement is idempotent-guarded.
-- litellm_engine owns ONLY database litellm; fleet_worker owns ONLY database fleet_worker.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='litellm_engine') THEN
    CREATE ROLE litellm_engine LOGIN PASSWORD 'engine-pw';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='fleet_worker') THEN
    CREATE ROLE fleet_worker LOGIN PASSWORD 'worker-pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE litellm OWNER litellm_engine' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='litellm')\gexec
SELECT 'CREATE DATABASE fleet_worker OWNER fleet_worker' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='fleet_worker')\gexec
REVOKE CONNECT ON DATABASE litellm FROM PUBLIC;
REVOKE CONNECT ON DATABASE fleet_worker FROM PUBLIC;
GRANT CONNECT ON DATABASE litellm TO litellm_engine;
GRANT CONNECT ON DATABASE fleet_worker TO fleet_worker;
\connect litellm
ALTER SCHEMA public OWNER TO litellm_engine;
\connect fleet_worker
ALTER SCHEMA public OWNER TO fleet_worker;
