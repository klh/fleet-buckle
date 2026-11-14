// buckle.laws.shapes.ts — the code-SHAPE laws: file naming, the type
// law, hand-casts, kit ownership, schema duplication, test mirroring.
// The runner + boundary laws (catch/env/knobs/yaml/lines) live in
// buckle.check-laws.ts; the file listing rides buckle.laws.scan.ts.
import { readFileSync } from "node:fs";
import { srcOrToolsTs, srcTests, tsFiles } from "./buckle.laws.scan.ts";

/** what a check reports into (factory-typed, the live-values idiom) */
export function createLawsCtx() {
  return { errors: [] as string[], warnings: [] as string[] };
}
export type LawsCtx = ReturnType<typeof createLawsCtx>;

// 1. naming: nested src/tools ts files are buckle.<thing>.<role>.ts or
//    barrels; src/ ROOT files (main, settings, kit, fault, problem, pick)
//    are the DAG's composition roots and live flat by design.
export function checkNaming(ctx: LawsCtx, files: string[]): void {
  for (const f of srcOrToolsTs(files)) {
    const base = f.split("/").pop() as string;
    if (base === "index.ts" || base.endsWith(".test.ts")) continue;
    const inSrcRoot = /\/src\/[^/]+\.ts$/.test(f);
    if (!inSrcRoot && !/^buckle\.[a-z0-9-]+(\.[a-z0-9-]+)*\.ts$/.test(base))
      ctx.errors.push(`naming: ${base} (expected buckle.<thing>.<role>.ts)`);
  }
}

// 2. REPO RULE: every type comes from a zod schema and typeof —
// hand-written interfaces and object-literal type aliases fail anywhere
// (src/, tools/, test/); a type alias is legal ONLY as z.output/z.input.
export function checkTypeLaw(ctx: LawsCtx, files: string[]): void {
  for (const f of tsFiles(files)) {
    const src = readFileSync(f, "utf8");
    const iface = src.match(/^\s*(export\s+)?interface\s+(\w+)/m);
    if (iface)
      ctx.errors.push(
        `${f}: hand-written interface "${iface[2]}" — derive it: type X = z.output<typeof XSchema>`,
      );
    const alias = src.match(/^\s*(export\s+)?type\s+\w+\s*=\s*\{/m);
    if (alias)
      ctx.errors.push(
        `${f}: hand-written object type alias — derive it: type X = z.output<typeof XSchema>`,
      );
  }
}

// 2b. no hand-casts (type law): responses parse through their zod wire
//     schema — `x as { ... }` anywhere is a defect, and so is a
//     NAMED-type cast on a response body (`.json() as BuckleX`): the
//     live bug it hid was the stats fold double-nesting peer bodies.
export function checkHandCasts(ctx: LawsCtx, files: string[]): void {
  for (const f of tsFiles(files)) {
    if (f.endsWith("buckle.check-laws.ts") || f.endsWith("buckle.laws.shapes.ts")) continue; // the law-definers quote their own patterns
    const src = readFileSync(f, "utf8");
    if (/\)\s*as\s*\{/.test(src))
      ctx.errors.push(
        `${f}: hand-cast object literal (\`as { … }\`) — parse through the zod wire schema`,
      );
    if (/\.json\(\)\s*\)?\s*as\s+[A-Z]/.test(src))
      ctx.errors.push(
        `${f}: named-type cast on a response body (\`.json() as X\`) — safeParse it through the wire schema`,
      );
  }
}

// 2c. kit-ownership: key dirs, stubs, recorders, world builders live
//     ONLY in buckle.server.kit.ts — a test file never hand-rolls them.
export function checkKitOwnership(ctx: LawsCtx, files: string[]): void {
  for (const f of srcTests(files)) {
    const src = readFileSync(f, "utf8");
    for (const owned of [
      "function stubProvider",
      "function stubEngine",
      "function recorder",
      "function mintKeyDir",
      "function keyDir(",
    ]) {
      if (src.includes(owned))
        ctx.errors.push(`${f}: hand-rolled ${owned.slice(9)}( — import it from kit.ts`);
    }
  }
}

/** every multi-field object shape a schema file declares, as a
 *  sorted field-set key (single-field shapes are cheap — skipped) */
function shapeKeysOf(src: string): string[] {
  const keys: string[] = [];
  for (const m of src.matchAll(/z\.object\(\s*\{([^}]+)\}\s*\)/g)) {
    const fields = [...m[1]!.matchAll(/^\s*([a-z_][a-z0-9_]*):/gm)]
      .map((x) => x[1])
      .sort()
      .join(",");
    if (fields.split(",").length >= 2) keys.push(fields);
  }
  return keys;
}

// 2d. schema composition: the same object field-set declared 3+ times
//     across schemas is a re-declaration — compose one canonical shape
//     (the BuckleLimits precedent: the limits triple once lived 5×).
export function checkSchemaDuplication(ctx: LawsCtx, files: string[]): void {
  const shapeCounts = new Map<string, string[]>();
  for (const f of files.filter(
    (f) => /\/schemas\/.*\.zod\.ts$/.test(f) && !f.endsWith(".test.ts"),
  )) {
    for (const fields of shapeKeysOf(readFileSync(f, "utf8"))) {
      const list = shapeCounts.get(fields) ?? [];
      list.push(f.split("/").pop()!);
      shapeCounts.set(fields, list);
    }
  }
  for (const [fields, where] of shapeCounts) {
    if (where.length >= 3)
      ctx.errors.push(
        `schema duplication: {${fields}} declared ${where.length}× (${where.join(", ")}) — compose ONE canonical shape`,
      );
  }
}

// 2e. test files mirror their module: buckle.server.<m>.test.ts needs a
//     sibling buckle.server.<m>.ts (federated.test.ts → federated.ts).
export function checkTestMirrors(ctx: LawsCtx, files: string[]): void {
  for (const f of srcTests(files)) {
    const module = f.replace(".test.ts", ".ts");
    if (!files.includes(module))
      ctx.errors.push(
        `${f.split("/").pop()}: no sibling module ${module.split("/").pop()} — test names mirror modules`,
      );
  }
}
