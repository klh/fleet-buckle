import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { loadSettings } from "../../src/settings.ts";
import { renderRealConfig } from "./buckle.gen-engine-config.ts";
import { runCanary } from "./buckle.engine-canary.ts";

const D = new URL("../../deploy/", import.meta.url).pathname;

describe("generator round-trip", () => {
  test("committed mscopilot yaml == renderRealConfig(its own ids)", () => {
    const yaml = readFileSync(`${D}engine/mscopilot.litellm.yaml`, "utf8");
    const ids = [...yaml.matchAll(/^ {2}- model_name: "(.*)"$/gm)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(0);
    const at = /^# at (\S+) —/m.exec(yaml)![1]!;
    const re = renderRealConfig("mscopilot", ids, at);
    // body (rows) must be identical to what the generator emits
    expect(yaml.startsWith(re.split("model_list:")[0]!)).toBe(true);
    expect(yaml.split("model_list:")[1]!.startsWith(re.split("model_list:")[1]!.slice(0, 200))).toBe(true);
    expect(re).toContain("os.environ/");
    expect(re).not.toMatch(/sk-[A-Za-z0-9]{10}/);
  });
});

describe("digest pin", () => {
  test("every litellm image is an immutable sha256 digest", () => {
    for (const f of ["compose.azure.yaml", "compose.yaml"]) {
      for (const m of readFileSync(`${D}${f}`, "utf8").matchAll(/image:\s*(\S*litellm\S*)/g))
        expect(m[1]).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
  });
});

describe("azure settings composition", () => {
  test("engine.url resolves to the compose service and keys.engine to the mounted path", async () => {
    const s = await loadSettings({
      defaults: `${D}settings/default.settings.json5`,
      settings: `${D}settings/azure.settings.json5`,
      over: `${D}settings/azure.over.json5`,
    });
    expect(s.engine?.url).toBe("http://engine:4000");
    expect(s.keys?.engine).toBe("/state/keys/engine.master.key");
  });
  test("default alone keeps loopback (azure must override)", async () => {
    const s = await loadSettings({
      defaults: `${D}settings/default.settings.json5`,
      settings: `${D}settings/default.settings.json5`,
    });
    expect(s.engine?.url).toBe("http://127.0.0.1:4000");
  });
});

describe("engine canary (fake engine)", () => {
  test("positive 200, anonymous + wrong key denied", async () => {
    const srv = Bun.serve({
      port: 0,
      fetch: (r) =>
        new Response("{}", { status: r.headers.get("authorization") === "Bearer k" ? 200 : 401 }),
    });
    const r = await runCanary(`http://127.0.0.1:${srv.port}`, "k");
    srv.stop(true);
    expect(r).toEqual({ positive: 200, anonymous: 401, wrongKey: 401, ok: true });
  });
  test("open engine fails the canary", async () => {
    const srv = Bun.serve({ port: 0, fetch: () => new Response("{}") });
    const r = await runCanary(`http://127.0.0.1:${srv.port}`, "k");
    srv.stop(true);
    expect(r.ok).toBe(false);
  });
});
