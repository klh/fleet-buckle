// buckle.laws.boundary.test.ts — forbidden and allowed fixtures for
// the boundary guard: each case is a tiny in-memory file map fed to
// the same check the laws runner executes on the real tree.
import { describe, expect, test } from "bun:test";
import {
  checkBoundaryEscape,
  checkLegacyRatchet,
  LEGACY_BASELINE,
  type FileRead,
} from "./buckle.laws.boundary.ts";
import { createLawsCtx } from "./buckle.laws.shapes.ts";

const of = (map: Record<string, string>): FileRead => (f) => {
  const v = map[f];
  if (v === undefined) throw new Error(`fixture miss: ${f}`);
  return v;
};

describe("boundary escape (forbidden)", () => {
  test("a relative import into ../fleet fails", () => {
    const ctx = createLawsCtx();
    checkBoundaryEscape(ctx, ["/repo/src/leak.ts"], of({ "/repo/src/leak.ts": `import { x } from "../../fleet/packages/buckle/src/x.ts";` }));
    expect(ctx.errors.length).toBe(1);
    expect(ctx.errors[0]).toContain("escapes the repo boundary");
  });

  test("a sibling-checkout string fails", () => {
    const ctx = createLawsCtx();
    checkBoundaryEscape(ctx, ["/repo/src/leak.ts"], of({ "/repo/src/leak.ts": `const FLEET = "/Volumes/Sensitive/github/klh/fleet/packages/settings";` }));
    expect(ctx.errors.length).toBe(1);
  });

  test("a file: dependency outside the repo fails", () => {
    const ctx = createLawsCtx();
    checkBoundaryEscape(ctx, ["/repo/package.json"], of({ "/repo/package.json": `{"dependencies":{"@klh/settings":"file:../fleet/packages/settings"}}` }));
    expect(ctx.errors.length).toBe(1);
  });
});

describe("boundary escape (allowed)", () => {
  test("this repo's own absolute path and normal imports pass", () => {
    const ctx = createLawsCtx();
    checkBoundaryEscape(
      ctx,
      ["/repo/src/ok.ts", "/repo/package.json"],
      of({
        "/repo/src/ok.ts": `import { x } from "./buckle.laws.scan.ts";\nconst HERE = "/Volumes/Sensitive/github/klh/fleet-buckle/src";`,
        "/repo/package.json": `{"dependencies":{"zod":"^4.1.0"}}`,
      }),
    );
    expect(ctx.errors.length).toBe(0);
  });
});

describe("legacy ratchet", () => {
  test("a new worker/agent/seed path fails", () => {
    const ctx = createLawsCtx();
    checkLegacyRatchet(ctx, ["/repo/src/worker.legacy.ts"]);
    expect(ctx.errors.length).toBe(1);
    expect(ctx.errors[0]).toContain("ratchet blocks additions");
  });

  test("baseline paths pass; a vanished one asks to shrink the baseline", () => {
    const ctx = createLawsCtx();
    checkLegacyRatchet(ctx, ["/repo/" + LEGACY_BASELINE[0]]);
    expect(ctx.errors.length).toBe(0);
    expect(ctx.warnings.length).toBe(LEGACY_BASELINE.length - 1);
  });

  test("fixtures and tests never count as legacy paths", () => {
    const ctx = createLawsCtx();
    checkLegacyRatchet(ctx, [
      "/repo/src/schemas/fixtures/seed.demo.json5",
      "/repo/src/agents/agents.seed.test.ts",
    ]);
    expect(ctx.errors.length).toBe(0);
  });
});
