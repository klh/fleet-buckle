import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BuckleEngineDemotion } from "./buckle.engine-demotion.zod.ts";
import fixture from "./fixtures/engine-demotion.json";

const engine = BuckleEngineDemotion.parse({ engine: fixture, model: "canary-chat" }).engine;

test("@unit demotion removes every deployment of the alias and preserves other engine config", () => {
  const result = BuckleEngineDemotion.parse({ engine: fixture, model: "canary-chat" });
  expect(result.removed).toBe(2);
  expect(result.engine).toEqual({ ...fixture, model_list: [fixture.model_list[1]] });
  expect(fixture.model_list).toHaveLength(3);
});

test("@unit demotion refuses absent aliases, malformed config and an empty remaining catalog", () => {
  expect(BuckleEngineDemotion.safeParse({ engine: fixture, model: "absent" }).success).toBe(false);
  expect(BuckleEngineDemotion.safeParse({ engine, model: "azure/test-twin" }).success).toBe(false);
  expect(BuckleEngineDemotion.safeParse({ engine: { model_list: [] }, model: "canary-chat" }).success).toBe(false);
  expect(BuckleEngineDemotion.safeParse({ engine: { model_list: [{ model_name: "canary-chat" }] }, model: "canary-chat" }).success).toBe(false);
});

test("@unit offline CLI generates a private candidate without replacing input or existing output", () => {
  const dir = mkdtempSync(join(tmpdir(), "buckle-demotion-"));
  const input = join(dir, "engine.yaml");
  const output = join(dir, "candidate.yaml");
  const yaml = Bun.YAML.stringify(fixture);
  writeFileSync(input, yaml);
  try {
    const args = ["tools/src/buckle.demote-engine-model.ts", input, output, "canary-chat"];
    const receipt = execFileSync(process.execPath, args, { encoding: "utf8" });
    expect(JSON.parse(receipt)).toEqual({ removed: 2, remaining: 1 });
    expect(Bun.YAML.parse(readFileSync(output, "utf8"))).toEqual(engine);
    expect(statSync(output).mode & 0o777).toBe(0o600);
    expect(readFileSync(input, "utf8")).toBe(yaml);
    const candidate = readFileSync(output, "utf8");
    expect(spawnSync(process.execPath, args).status).not.toBe(0);
    expect(readFileSync(output, "utf8")).toBe(candidate);
    expect(spawnSync(process.execPath, [args[0]!, input, input, "canary-chat"]).status).not.toBe(0);
    expect(readFileSync(input, "utf8")).toBe(yaml);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("@unit CLI refusal creates no candidate and does not leak malformed config", () => {
  const dir = mkdtempSync(join(tmpdir(), "buckle-demotion-invalid-"));
  const input = join(dir, "engine.yaml");
  const output = join(dir, "candidate.yaml");
  const args = ["tools/src/buckle.demote-engine-model.ts", input, output, "absent"];
  try {
    writeFileSync(input, Bun.YAML.stringify(fixture));
    expect(spawnSync(process.execPath, args).status).not.toBe(0);
    writeFileSync(input, "model_list: [malformed-credential-sentinel");
    const failed = spawnSync(process.execPath, args, { encoding: "utf8" });
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).not.toContain("malformed-credential-sentinel");
    expect(failed.stdout).toBe("");
    expect(() => statSync(output)).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
