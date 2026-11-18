// buckle.laws.boundary.ts — the boundary guard the implementation
// contract requires before multiple feature lanes dispatch: no new
// source/dependency path may reach into the fleet monorepo or any
// sibling checkout (buckle composes published artifacts only), and
// the legacy worker/agent/seed paths ratchet against a reviewed
// baseline so extraction can only SHRINK them. A path scan cannot
// see a scheduler hidden in a proxy file — semantic ownership still
// rides diff review; this is the structural half only.
import { readFileSync } from "node:fs";
import type { LawsCtx } from "./buckle.laws.shapes.ts";

/** how a check reads a file (disk by default; tests inject a map) */
export type FileRead = (f: string) => string;
export const diskRead: FileRead = (f) => readFileSync(f, "utf8");

// a spec string naming another klh repo, a relative hop into ../fleet,
// or a local file: dependency pointing outside this checkout.
const ESCAPE =
  /github\/klh\/(?!fleet-buckle)[\w.-]+|\.\.\/fleet\/|file:\.\.\/|file:\/Volumes/;

/** boundary law: source/dependency paths stay inside fleet-buckle */
export function checkBoundaryEscape(
  ctx: LawsCtx,
  files: string[],
  read: FileRead = diskRead,
): void {
  for (const f of files.filter((f) => /\.ts$|\.json$/.test(f))) {
    // tests quote forbidden shapes as fixtures — they are the law's
    // own evidence, not violations (the ratchet below still counts them)
    if (f.endsWith(".test.ts") || f.includes("/node_modules/") || f.includes("/.qlty/"))
      continue;
    if (ESCAPE.test(read(f)))
      ctx.errors.push(
        `${f}: path escapes the repo boundary (sibling checkout or external file: dep) — depend on published artifacts, never on a neighboring checkout`,
      );
  }
}

// reviewed baseline (post P1.5 extraction): every legacy worker/agent/
// seed path still standing. ADDITIONS fail the law; REMOVALS shrink
// this list — the ratchet only turns one way.
export const LEGACY_BASELINE: string[] = [
];

const rel = (f: string): string => f.slice(f.indexOf("src/"));

const isLegacyPath = (f: string): boolean =>
  /worker|agent|seed/.test(f) &&
  /\.ts$|\.json5$|\.json$|\.yaml$/.test(f) &&
  !f.endsWith(".test.ts") &&
  !f.includes("/fixtures/");

/** ratchet law: the legacy set shrinks-only against the baseline */
export function checkLegacyRatchet(ctx: LawsCtx, files: string[]): void {
  const standing = files.filter(isLegacyPath).map(rel);
  for (const f of standing) {
    if (!LEGACY_BASELINE.includes(f))
      ctx.errors.push(
        `${f}: new legacy worker/agent/seed path — the ratchet blocks additions (implementation-contract); grow worker capability in fleet-worker instead`,
      );
  }
  for (const b of LEGACY_BASELINE)
    if (!standing.includes(b))
      ctx.warnings.push(
        `${b}: gone from the tree — shrink LEGACY_BASELINE in tools/src/buckle.laws.boundary.ts`,
      );
}
