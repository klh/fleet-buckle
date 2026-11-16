// settings.test.ts — the hot-over regression: the over layer is the
// ONE runtime-written settings file, and a dynamic import() of the
// same path returns Bun's FIRST cached parse forever — edit #2 landed
// on disk while the reload kept serving edit #1 (live-verified
// 2026-11-15 on the azure hub: the /admin/hubs repin was a no-op
// until buckle restarted). This test re-fires that exact sequence.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { loadSettings } from "./settings.ts";

const dir = mkdtempSync(join(tmpdir(), "buckle-over-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const defaults = join(dir, "defaults.json5");
const settings = join(dir, "unit.json5");
const over = join(dir, "over.json5");
writeFileSync(defaults, JSON.stringify({ hub: { label: "t", ports: {} } }));
writeFileSync(settings, JSON.stringify({ hub: { label: "t", ports: {} }, lanes: [] }));

describe("loadSettings — the hot over layer", () => {
  test("a MISSING over file is an empty layer (fresh volume boots clean)", async () => {
    const s = await loadSettings({ defaults, settings, over });
    expect(s.lanes).toEqual([]);
  });

  test("edit #1 applies (first import was never the bug)", async () => {
    writeFileSync(over, JSON.stringify({ lanes: [{ id: "l1", model: "one" }] }));
    const s = await loadSettings({ defaults, settings, over });
    expect(s.lanes).toEqual([{ id: "l1", model: "one" }]);
  });

  test("REGRESSION: edit #2 must not serve the cached first parse", async () => {
    writeFileSync(over, JSON.stringify({ lanes: [{ id: "l1", model: "two" }] }));
    const s = await loadSettings({ defaults, settings, over });
    expect(s.lanes).toEqual([{ id: "l1", model: "two" }]);
  });

  test("a malformed over file fails LOUD (never a silent stale read)", () => {
    writeFileSync(over, "{ not json5");
    expect(loadSettings({ defaults, settings, over })).rejects.toThrow(/malformed/);
  });
});
