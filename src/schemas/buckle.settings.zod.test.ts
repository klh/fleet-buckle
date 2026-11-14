// buckle.settings.zod.test.ts — colocated unit (bun test): the settings
// laws — JSON5 shape, PATHS not values, fail-loud unknowns, deep merge.
import { describe, expect, test } from "bun:test";
import { mergeSettings, BuckleSettings } from "./buckle.settings.zod.ts";
// the REAL deploy files are the single source — no fixture copies
import defaultSettings from "../../deploy/settings/default.settings.json5";
// the TOPOLOGY unit (peers b2/b3) — deploy/settings/b1 is the REAL
// single hub (no peers); this test merges the 3-unit topology
import b1Settings from "../../test/deploy/settings/b1.settings.json5";

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
    expect(parsed.providers?.['zai']?.key).toBe("/etc/k");
  });

  test("downstream peers are declared under hubs — never an upstream list", () => {
    const merged = mergeSettings(defaultSettings, b1Settings);
    // b1 declares b2,b3; nothing else exists in the file
    expect(merged.hubs?.['b2']?.url).toMatch(/^http/);
  });

  // the provider REGISTRY: recognized providers default from it
  test("a recognized provider with no url/dialect resolves from the registry (the REAL endpoint)", () => {
    const parsed = BuckleSettings.parse({
      hub: { label: "x" },
      providers: { openrouter: { key: "/etc/k" } },
    });
    expect(parsed.providers?.['openrouter']?.url).toBe("https://openrouter.ai/api/v1");
    expect(parsed.providers?.['openrouter']?.dialect).toBe("openai");
    const copilot = BuckleSettings.parse({
      hub: { label: "x" },
      providers: { mscopilot: {} },
    });
    expect(copilot.providers?.['mscopilot']?.dialect).toBe("github_copilot");
  });

  test("an explicit url overrides the registry default (the stub over-layer does this)", () => {
    const parsed = BuckleSettings.parse({
      hub: { label: "x" },
      providers: { openrouter: { url: "http://openrouter-stub:8080" } },
    });
    expect(parsed.providers?.['openrouter']?.url).toBe("http://openrouter-stub:8080");
  });

  test("an unknown provider without an explicit url/dialect fails loud as PARSE issues", () => {
    const r = BuckleSettings.safeParse({
      hub: { label: "x" },
      providers: { weird: {} },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("providers.weird.url");
      expect(paths).toContain("providers.weird.dialect");
    }
  });

  test("an unknown provider WITH an explicit url and dialect is self-serve and parses", () => {
    const parsed = BuckleSettings.parse({
      hub: { label: "x" },
      providers: {
        myown: { url: "https://api.example.com/v1", dialect: "openai" },
      },
    });
    expect(parsed.providers?.['myown']?.url).toBe("https://api.example.com/v1");
  });

  test("the over layer REPLACES a resolved registry url (real ⊕ stub merge)", () => {
    // unit file omits url (registry real default); the stub over replaces it
    const unit = { hub: { label: "x" }, providers: { zai: { key: "/k" } } };
    const over = { providers: { zai: { url: "http://zai-stub:8080" } } };
    const merged = mergeSettings(mergeSettings(defaultSettings, unit), over);
    expect(merged.providers?.['zai']?.url).toBe("http://zai-stub:8080");
  });
});
