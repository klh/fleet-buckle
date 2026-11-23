// revocation.probe.spec.ts — B04.1 acceptance: the REAL-ingress revocation
// probe. Boots a THROWAWAY container of the freshly built buckle image
// (PROBE_IMAGE) on the compose network buckle_default via the Docker
// Engine API (fetch over the unix socket — no docker CLI), then:
//   mint (admin API) -> 200 on /v1/models + /v1/chat/completions
//   -> revoke -> immediate denial on both -> bystander still 200.
// Revocation here = the settings `revoked:true` row landing in the over
// layer, then the admin reload seam (POST /admin/hubs {}) swapping live
// settings; buckle has no dedicated revoke endpoint. Emits a JSON receipt
// to PROBE_RECEIPT (default test-results/revocation.receipt.json).
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOCK = "/var/run/docker.sock";
const IMAGE = process.env["PROBE_IMAGE"] ?? "buckle:b814c4b-probe";
const STUB_IMAGE = process.env["PROBE_STUB_IMAGE"] ?? "probe-stub:local";
const NET = "buckle_default";
const run = String(Date.now());
const here = (f: string) => fileURLToPath(new URL(f, import.meta.url));

async function docker(method: string, path: string, body?: string | Uint8Array, headers: Record<string, string> = {}) {
  const res = await fetch(`http://docker${path}`, { method, body, headers, unix: SOCK } as RequestInit);
  const text = await res.text();
  if (res.status >= 400) throw new Error(`docker ${method} ${path}: ${res.status} ${text}`);
  return text === "" ? null : (JSON.parse(text) as Record<string, any>);
}

/** minimal ustar writer (one file per entry) via the system tar */
function tarOf(files: { name: string; content: string; mode: string }[]): Uint8Array {
  const dir = execFileSync("mktemp", ["-d"]).toString().trim();
  for (const f of files) {
    const p = `${dir}/${f.name}`;
    mkdirSync(p.replace(/\/[^/]*$/, ""), { recursive: true });
    writeFileSync(p, f.content, { mode: parseInt(f.mode, 8) });
  }
  return new Uint8Array(execFileSync("tar", ["-C", dir, "-cf", "-", "."]));
}

const put = (id: string, files: Parameters<typeof tarOf>[0]) =>
  docker("PUT", `/containers/${id}/archive?path=/`, tarOf(files), { "content-type": "application/x-tar" });

async function create(name: string, spec: object) {
  const c = await docker("POST", `/containers/create?name=${name}`, JSON.stringify(spec), {
    "content-type": "application/json",
  });
  return c!["Id"] as string;
}

const base = (ip: string) => `http://${ip}:4111`;
const authed = (key: string) => ({ authorization: `Bearer ${key}` });
const chatBody = JSON.stringify({ model: "glm-4.5", messages: [{ role: "user", content: "hi" }] });

test("B04.1 real-ingress revocation probe", async () => {
  test.setTimeout(180_000);
  const stubName = `probe-stub-${run}`;
  const bName = `probe-buckle-${run}`;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const stamp = (k: string) => (t[k] = new Date().toISOString());
  try {
    const stubId = await create(stubName, {
      Image: STUB_IMAGE,
      NetworkingConfig: { EndpointsConfig: { [NET]: { Aliases: ["probe-stub"] } } },
      HostConfig: { NetworkMode: NET },
    });
    ids.push(stubId);
    await put(stubId, [{ name: "etc/stub/models.json", content: readFileSync(here("../fixtures/zai.models.json"), "utf8"), mode: "0644" }]);
    await docker("POST", `/containers/${stubId}/start`);

    const adminKey = "bksk_probeadmin" + run;
    const bId = await create(bName, {
      Image: IMAGE,
      Env: [
        "BUCKLE_SETTINGS=/etc/buckle/settings.json5",
        "BUCKLE_DEFAULTS=/etc/buckle/default.settings.json5",
        "BUCKLE_SETTINGS_OVER=/state/over.json5",
      ],
      NetworkingConfig: { EndpointsConfig: { [NET]: {} } },
      HostConfig: { NetworkMode: NET },
    });
    ids.push(bId);
    await put(bId, [
      { name: "etc/buckle/settings.json5", content: readFileSync(here("revocation.settings.json5"), "utf8"), mode: "0644" },
      { name: "etc/buckle/default.settings.json5", content: readFileSync(here("../../../deploy/settings/default.settings.json5"), "utf8"), mode: "0644" },
      { name: "state/keys/zai.key", content: "stub-provider-key\n", mode: "0600" },
      { name: "state/keys/principal.admin@probe.key", content: adminKey + "\n", mode: "0600" },
    ]);
    await docker("POST", `/containers/${bId}/start`);
    const info = await docker("GET", `/containers/${bId}/json`);
    const imageId = info!["Image"] as string;
    const ip = info!["NetworkSettings"].Networks[NET].IPAddress as string;
    const stubIp = (await docker("GET", `/containers/${stubId}/json`))!["NetworkSettings"].Networks[NET].IPAddress;
    expect(stubIp).toBeTruthy();
    await expect.poll(async () => (await fetch(`${base(ip)}/healthz`).catch(() => null))?.status, { timeout: 30_000 }).toBe(200);

    const mint = async (principal: string) => {
      const r = await fetch(`${base(ip)}/admin/keys`, {
        method: "POST",
        headers: { ...authed(adminKey), "content-type": "application/json" },
        body: JSON.stringify({ principal }),
      });
      expect(r.status).toBe(201);
      return ((await r.json()) as { key: string }).key;
    };
    const victim = await mint("victim@probe");
    const bystander = await mint("bystander@probe");
    stamp("minted");
    const models = (k: string) => fetch(`${base(ip)}/v1/models`, { headers: authed(k) });
    const chat = (k: string) =>
      fetch(`${base(ip)}/v1/chat/completions`, {
        method: "POST",
        headers: { ...authed(k), "content-type": "application/json" },
        body: chatBody,
      });

    // BEFORE
    const before = { models: (await models(victim)).status, chat: (await chat(victim)).status, bystanderModels: (await models(bystander)).status, bystanderChat: (await chat(bystander)).status };
    stamp("before");
    expect(before).toEqual({ models: 200, chat: 200, bystanderModels: 200, bystanderChat: 200 });

    // REVOKE: revoked row into the over layer, then the admin reload seam
    const settings = readFileSync(here("revocation.settings.json5"), "utf8");
    expect(settings).toContain("victim@probe");
    const over = {
      access: {
        principals: [
          { id: "admin@probe", kind: "service", groups: [] },
          { id: "victim@probe", kind: "human", groups: [], revoked: true },
          { id: "bystander@probe", kind: "human", groups: [] },
        ],
      },
    };
    await put(bId, [{ name: "state/over.json5", content: JSON.stringify(over), mode: "0600" }]);
    const reload = await fetch(`${base(ip)}/admin/hubs`, {
      method: "POST",
      headers: { ...authed(adminKey), "content-type": "application/json" },
      body: "{}",
    });
    stamp("revoked");
    expect(reload.status).toBe(200);

    // AFTER — immediate
    const after = { models: (await models(victim)).status, chat: (await chat(victim)).status, bystanderModels: (await models(bystander)).status, bystanderChat: (await chat(bystander)).status };
    stamp("after");
    expect([400, 401, 403]).toContain(after.models);
    expect([400, 401, 403]).toContain(after.chat);
    expect(after.bystanderModels).toBe(200);
    expect(after.bystanderChat).toBe(200);

    const receipt = { image: IMAGE, imageId, stubImage: STUB_IMAGE, container: bName, network: NET, principals: { victim: "victim@probe", bystander: "bystander@probe" }, keyIds: { victim: victim.slice(0, 9) + "…", bystander: bystander.slice(0, 9) + "…" }, before, after, timestamps: t };
    const out = process.env["PROBE_RECEIPT"] ?? "test-results/revocation.receipt.json";
    mkdirSync(out.replace(/\/[^/]*$/, ""), { recursive: true });
    writeFileSync(out, JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt));
  } finally {
    for (const id of ids.reverse()) await docker("DELETE", `/containers/${id}?force=true`).catch(() => null);
  }
});
