// smoke: the schema-first contract holds — openapi.json is in sync with
// the wire schemas, and every fixture parses against its schema.
import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BuckleTreeResponse,
  mergeSettings,
} from "../../src/schemas/index.ts";
import defaultSettings from "../../deploy/settings/default.settings.json5";
import b1Settings from "../../deploy/settings/b1.settings.json5";
import demoTree from "../../src/schemas/fixtures/tree.demo.json";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("openapi.json is generated, committed, in sync", () => {
  execSync("bun tools/src/buckle.gen-openapi.ts --check", { cwd: root });
  const doc = JSON.parse(readFileSync(`${root}/openapi.json`, "utf8"));
  expect(doc.openapi).toBe("3.1.0");
  expect(Object.keys(doc.paths)).toEqual(
    expect.arrayContaining(["/v1/models", "/v1/tree", "/stats"]),
  );
});

test("demo tree fixture parses against the tree schema", () => {
  const tree = BuckleTreeResponse.parse(demoTree);
  expect(tree.self.buckle.label).toBe("b1");
});

test("demo settings compose: default ⊕ b1 parses and declares peers", () => {
  const merged = mergeSettings(defaultSettings, b1Settings);
  expect(merged.hub.label).toBe("b1");
  expect(Object.keys(merged.hubs ?? {}).sort()).toEqual(["b2", "b3"]);
});
