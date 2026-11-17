// buckle.check-laws.ts — every law has a check or it is a wish.
// The RUNNER plus the boundary laws (catch, env, timeout knobs, yaml,
// line caps); the code-shape laws live in buckle.laws.shapes.ts and
// the file listing rides buckle.laws.scan.ts.
import { readFileSync } from "node:fs";
import { SRC, root, srcModules, walk } from "./buckle.laws.scan.ts";
import {
  checkHandCasts,
  checkKitOwnership,
  checkNaming,
  checkSchemaDuplication,
  checkTestMirrors,
  checkTypeLaw,
  createLawsCtx,
  type LawsCtx,
} from "./buckle.laws.shapes.ts";
import { checkBoundaryEscape, checkLegacyRatchet } from "./buckle.laws.boundary.ts";

// 2f. no-try-catch: the ONLY sanctioned catch boundary in src/ is
//     fault.ts (classify, never swallow) and settings.ts (readToken/
//     listDir fault classification). Every other src module composes
//     typed Fault values — a bare catch anywhere else is a defect.
function checkNoCatch(ctx: LawsCtx, files: string[]): void {
  for (const f of srcModules(files)) {
    const base = f.split("/").pop() as string;
    if (base === "fault.ts" || base === "settings.ts") continue;
    if (/\} catch/.test(readFileSync(f, "utf8")))
      ctx.errors.push(
        `${f}: bare catch — the only catch boundary is fault.ts (+ settings.ts readToken/listDir); compose typed Faults instead`,
      );
  }
}

// 2g. env boundary: process.env is read ONLY by the settings loader
//     (src/settings.ts). Every knob — urls, timeouts, telemetry —
//     lives in the settings schema; a scattered env read is a defect.
function checkEnvBoundary(ctx: LawsCtx, files: string[]): void {
  for (const f of srcModules(files)) {
    if (f === SRC + "settings.ts") continue;
    if (/process\.env/.test(readFileSync(f, "utf8")))
      ctx.errors.push(
        `${f}: process.env outside the loader (src/settings.ts) — the knob belongs in the settings schema`,
      );
  }
}

// 2h. timeout knobs: every bounded wait lives in the settings schema
//     (timeouts.*). A module-local TIMEOUT_MS constant is a scattered
//     knob — fail. (TPS_WINDOW_MS is definitional, not a wait bound.)
function checkTimeoutKnobs(ctx: LawsCtx, files: string[]): void {
  for (const f of srcModules(files)) {
    if (f.endsWith("buckle.settings.zod.ts")) continue;
    if (/TIMEOUT_MS\s*=/.test(readFileSync(f, "utf8")))
      ctx.errors.push(
        `${f}: module-local TIMEOUT constant — the knob belongs in settings.timeouts (one home, zod-defaulted)`,
      );
  }
}

// 3. no AUTHORED yaml outside compose wiring (docker-compose is wiring
//    only). test/deploy/engine/*.litellm.yaml is GENERATED from the captured
//    fixtures (buckle.gen-engine-config.ts, gitignored) — litellm only
//    reads yaml configs, so generated-and-never-edited is the sanctioned
//    exception.
function checkYaml(ctx: LawsCtx, files: string[]): void {
  for (const f of files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))) {
    if (!f.includes("/deploy/compose") && !f.includes("/deploy/engine/"))
      ctx.errors.push(`yaml authored outside compose wiring: ${f}`);
  }
}

// 4. line caps: warn 400, hard fail 1500
function checkLineCaps(ctx: LawsCtx, files: string[]): void {
  for (const f of files.filter((f) => f.endsWith(".ts"))) {
    const lines = readFileSync(f, "utf8").split("\n").length;
    if (lines > 1500) ctx.errors.push(`${f}: ${lines} lines — hard cap 1500`);
    else if (lines > 400)
      ctx.warnings.push(`${f}: ${lines} lines — you are composing wrong (warn at 400)`);
  }
}

const checks = [
  checkNaming,
  checkTypeLaw,
  checkHandCasts,
  checkKitOwnership,
  checkSchemaDuplication,
  checkTestMirrors,
  checkNoCatch,
  checkEnvBoundary,
  checkTimeoutKnobs,
  checkYaml,
  checkLineCaps,
  checkBoundaryEscape,
  checkLegacyRatchet,
];

const ctx = createLawsCtx();
const files = walk(root);
for (const check of checks) check(ctx, files);
for (const w of ctx.warnings) console.warn(`WARN ${w}`);
if (ctx.errors.length > 0) {
  for (const e of ctx.errors) console.error(`LAW ${e}`);
  process.exit(1);
}
console.log(`laws hold (${files.length} files checked, ${ctx.warnings.length} warnings)`);
