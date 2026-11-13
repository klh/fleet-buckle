// buckle.settings.zod.test.ts — colocated unit (bun test): the settings
// laws — JSON5 shape, PATHS not values, fail-loud unknowns, deep merge.
import { describe, expect, test } from "bun:test";
import { mergeSettings, BuckleSettings } from "./buckle.settings.zod.ts";
import defaultSettings from "./fixtures/default.settings.json5";
import b1Settings from "./fixtures/b1.settings.json5";

describe("BuckleSettings", () => {
  test("default ⊕ b1 deep-merges: providers and peers land, defaults hold", () => {
    const merged = mergeSettings(defaultSettings, b1Settings);
    expect(merged.hub.label).toBe("b1");
    expect(Object.keys(merged.providers ?? {})).toEqual(["openrouter"]);
    expect(Object.keys(merged.hubs ?? {}).sort()).toEqual(["b2", "b3"]);
    // scalars replace, never concat
    expect(merged.limits?.max_concurrent).toBe(1000);
  });

  test("unknown fields fail loud", () => {
    expect(() =>
      BuckleSettings.parse({
        hub: { label: "x" },
        engine_port: 4100,
      }),
    ).toThrow();
  });

  test("a provider key is a PATH — the PATH-not-value law is review + fixture-checked", () => {
    const parsed = BuckleSettings.parse({
      hub: { label: "x" },
      providers: { zai: { url: "https://api.z.ai/api", key: "/etc/k" } },
    });
    expect(parsed.providers?.zai?.key).toBe("/etc/k");
  });

  test("downstream peers are declared under hubs — never an upstream list", () => {
    const merged = mergeSettings(defaultSettings, b1Settings);
    // b1 declares b2,b3; nothing else exists in the file
    expect(merged.hubs?.b2?.url).toMatch(/^http/);
  });
});
