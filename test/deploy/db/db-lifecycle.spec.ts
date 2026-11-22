// B02 QUAL: production database lifecycle on a throwaway postgres:16 + the PINNED LiteLLM image.
// Cases: migration once/idempotent, role split, pg_dump round-trip, DB-outage deny path.
// Needs /var/run/docker.sock. The outage case RECORDS what the pinned image does and asserts
// the Buckle-side contract (readiness is not an authorization signal).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as d from "./docker.fixture.ts";

const IMG = "ghcr.io/berriai/litellm@sha256:bd089afdcd35b894b14a93f9743cdc8b591f82da1a38dd43a010a7b0c9de5fd7"; // v1.103.0
const SUF = `${process.pid}`;
const NET = `b02net${SUF}`, PG = `b02pg${SUF}`, LE = `b02le${SUF}`;
const SALT = "sk-b02-salt-key";
const read = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
const CFG = "model_list:\n  - model_name: fake\n    litellm_params: {model: openai/fake, api_base: http://127.0.0.1:1, api_key: x}\ngeneral_settings:\n  master_key: sk-master\n";

const psql = (db: string, user: string, sql: string, pw = "pw") =>
  d.exec(PG, ["env", `PGPASSWORD=${pw}`, "psql", "-h", "127.0.0.1", "-U", user, "-d", db, "-tA", "-v", "ON_ERROR_STOP=1", "-f", "-"], sql);
const sup = (db: string, sql: string) => d.exec(PG, ["psql", "-U", "postgres", "-d", db, "-tA", "-v", "ON_ERROR_STOP=1", "-f", "-"], sql);

const PY = "import sys,urllib.request as u,json\nm,p,a,b=sys.argv[1:5]\nr=u.Request('http://127.0.0.1:4000'+p,data=(b.encode() if b else None),headers=json.loads(a),method=m)\ntry:\n x=u.urlopen(r,timeout=25);print(x.status,x.read()[:3000].decode())\nexcept u.HTTPError as e:\n print(e.code,e.read()[:300].decode())\nexcept Exception as e:\n print('ERR',repr(e)[:200])";
const short = (s: string) => s.slice(0, 220);
const http = async (m: string, p: string, h: object, b?: object) =>
  (await d.exec(LE, ["python3", "-c", PY, m, p, JSON.stringify(h), b ? JSON.stringify(b) : ""])).out.trim();
const MASTER = { authorization: "Bearer sk-master", "content-type": "application/json" };
const CHAT = { model: "fake", messages: [{ role: "user", content: "hi" }] };

async function startEngine(): Promise<void> {
  await d.run(LE, {
    Image: IMG,
    Entrypoint: ["sh", "-c", 'printf \'%s\' "$CFG" > /c.yaml; exec litellm "$@"', "x"],
    Cmd: ["--config", "/c.yaml", "--port", "4000"],
    Env: [`CFG=${CFG}`, `DATABASE_URL=postgresql://litellm_engine:engine-pw@${PG}:5432/litellm`, `LITELLM_SALT_KEY=${SALT}`, "STORE_MODEL_IN_DB=False"],
    HostConfig: { NetworkMode: NET },
  });
  await d.waitFor(async () => (await http("GET", "/health/readiness", {})).startsWith("200"), 240_000, "engine readiness");
}
const logs = async () => (await d.api("GET", `/containers/${LE}/logs?stdout=1&stderr=1`)).text.replace(/[\x00-\x08]/g, "");

const rec: Record<string, unknown> = {};
let key = "";

test.describe.configure({ mode: "serial", timeout: 600_000 });

test.beforeAll(async () => {
  await d.netCreate(NET);
  await d.run(PG, { Image: "postgres:16", Env: ["POSTGRES_PASSWORD=pw"], HostConfig: { NetworkMode: NET } });
  await d.waitFor(async () => (await d.exec(PG, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres"])).code === 0, 60_000, "pg");
  await new Promise((r) => setTimeout(r, 3000));
});
test.afterAll(async () => {
  console.log("B02-RECORD " + JSON.stringify(rec, null, 1));
  await d.rm(LE); await d.rm(PG); await d.netRm(NET);
});

test("1 roles + worker migration run once and are idempotent-guarded", async () => {
  const r1 = await sup("postgres", read("roles.sql"));
  expect(r1.code).toBe(0);
  const r2 = await sup("postgres", read("roles.sql")); // re-run: no error, no duplicate role
  expect(r2.code).toBe(0);
  expect((await sup("postgres", "select count(*) from pg_roles where rolname in ('litellm_engine','fleet_worker')")).out.trim()).toBe("2");
  for (let i = 0; i < 3; i++) expect((await psql("fleet_worker", "fleet_worker", read("migrate.sql"), "worker-pw")).code).toBe(0);
  expect((await psql("fleet_worker", "fleet_worker", "select count(*) from schema_migrations where id='0001_worker_tasks'", "worker-pw")).out.trim()).toBe("1");

  // engine migration: first boot applies prisma migrations, second boot applies none
  await startEngine();
  const count = async () => (await psql("litellm", "litellm_engine", "select count(*) from _prisma_migrations where finished_at is not null", "engine-pw")).out.trim();
  const first = await count();
  expect(Number(first)).toBeGreaterThan(10);
  expect(await logs()).toContain("prisma migrate deploy completed");
  await d.stop(LE); await d.start(LE);
  await d.waitFor(async () => (await http("GET", "/health/readiness", {})).startsWith("200"), 240_000, "engine readiness 2");
  expect(await count()).toBe(first);
  rec['migrations'] = { engineApplied: first, afterRestart: await count() };
});

test("2 worker role cannot touch engine DB and vice versa", async () => {
  const w = await psql("litellm", "fleet_worker", 'select * from "LiteLLM_VerificationToken"', "worker-pw");
  expect(w.code).not.toBe(0);
  expect(w.out).toMatch(/permission denied for database "litellm"/);
  const e = await psql("fleet_worker", "litellm_engine", "select * from worker_tasks", "engine-pw");
  expect(e.code).not.toBe(0);
  expect(e.out).toMatch(/permission denied for database "fleet_worker"/);
  // positive controls
  expect((await psql("litellm", "litellm_engine", 'select count(*) from "LiteLLM_VerificationToken"', "engine-pw")).code).toBe(0);
  expect((await psql("fleet_worker", "fleet_worker", "select count(*) from worker_tasks", "worker-pw")).code).toBe(0);
  // even if CONNECT were granted, table-level privileges are absent (defence in depth)
  await sup("postgres", "GRANT CONNECT ON DATABASE litellm TO fleet_worker");
  const w2 = await psql("litellm", "fleet_worker", 'select * from "LiteLLM_VerificationToken"', "worker-pw");
  expect(w2.out).toMatch(/permission denied for table LiteLLM_VerificationToken/);
  await sup("postgres", "REVOKE CONNECT ON DATABASE litellm FROM fleet_worker");
  rec['roles'] = { workerToEngine: w.out.trim(), engineToWorker: e.out.trim(), workerTableLevel: w2.out.trim() };
});

test("3 pg_dump restore round-trip on a second database", async () => {
  const g = JSON.parse((await http("POST", "/key/generate", MASTER, { models: ["fake"] })).slice(4)) as { key: string };
  key = g.key;
  const q = 'select count(*) from "LiteLLM_VerificationToken"';
  const before = (await psql("litellm", "litellm_engine", q, "engine-pw")).out.trim();
  expect(Number(before)).toBeGreaterThanOrEqual(1);
  const dump = await d.exec(PG, ["env", "PGPASSWORD=engine-pw", "sh", "-c", "pg_dump -h 127.0.0.1 -U litellm_engine -d litellm --no-owner -Fp > /tmp/litellm.sql && wc -c < /tmp/litellm.sql"]);
  expect(dump.code).toBe(0);
  await sup("postgres", "CREATE DATABASE litellm_restore");
  const rs = await d.exec(PG, ["sh", "-c", "psql -U postgres -d litellm_restore -v ON_ERROR_STOP=1 -q -f /tmp/litellm.sql >/dev/null"]);
  expect(rs.code).toBe(0);
  const after = (await sup("litellm_restore", q)).out.trim();
  expect(after).toBe(before);
  const tokA = (await psql("litellm", "litellm_engine", 'select md5(string_agg(token,\',\' order by token)) from "LiteLLM_VerificationToken"', "engine-pw")).out.trim();
  const tokB = (await sup("litellm_restore", 'select md5(string_agg(token,\',\' order by token)) from "LiteLLM_VerificationToken"')).out.trim();
  expect(tokB).toBe(tokA);
  rec['backup'] = { dumpBytes: dump.out.trim(), tokens: before, restoredTokens: after, md5: tokA };
});

test("4 DB outage: record the pinned image's behavior; readiness is not an authorization signal", async () => {
  const K = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  const probe = async () => ({
    readiness: await http("GET", "/health/readiness", {}),
    cachedKeyModels: await http("GET", "/v1/models", K),
    cachedKeyChat: await http("POST", "/v1/chat/completions", K, CHAT),
    unknownKeyModels: await http("GET", "/v1/models", { authorization: "Bearer sk-never-minted" }),
    masterModels: await http("GET", "/v1/models", MASTER),
  });
  expect((await http("GET", "/v1/models", K)).startsWith("200")).toBe(true); // warm the key cache
  const up = await probe();
  await d.stop(PG);
  await new Promise((r) => setTimeout(r, 3000));
  const down = await probe();
  // a key the engine has never cached cannot be verified without the DB
  const fresh = await http("GET", "/v1/models", { authorization: "Bearer sk-1234567890abcdefghijklmnop" });
  await d.start(PG);
  await d.waitFor(async () => (await d.exec(PG, ["pg_isready", "-h", "127.0.0.1", "-U", "postgres"])).code === 0, 60_000, "pg back");
  await new Promise((r) => setTimeout(r, 8000));
  const back = await probe();
  rec['outage'] = { up, down, freshUnknownKeyDuringOutage: fresh, back };
  // the unverifiable key is never admitted with a 2xx
  expect(down.unknownKeyModels.startsWith("2")).toBe(false);
  expect(fresh.startsWith("2")).toBe(false);
  // Buckle-side contract: readiness during outage must not be trusted as proof of grants;
  // the outside probe must use the scoped positive/negative request (up.cachedKeyChat is the
  // positive shape, unknownKeyModels the negative).
  expect(up.unknownKeyModels.startsWith("2")).toBe(false);
});
