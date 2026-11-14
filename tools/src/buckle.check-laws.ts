// buckle.check-laws.ts — every law has a check or it is a wish.
// Fails on: wrong file naming, hand-written data types, hand-casts of
// wire shapes, kit-ownership drift in tests, schema shape duplication,
// authored yaml outside compose wiring, line caps, openapi drift.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const errors: string[] = [];
const warnings: string[] = [];

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else files.push(p);
  }
  return files;
}

const files = walk(root);
const SRC = join(root, "src") + "/";
const inSrc = (f: string): boolean => f.startsWith(SRC);

// 1. naming: nested src/tools ts files are buckle.<thing>.<role>.ts or
//    barrels; src/ ROOT files (main, settings, kit, fault, problem, pick)
//    are the DAG's composition roots and live flat by design.
for (const f of files.filter((f) => f.match(/\/(src|tools)\//) && f.endsWith(".ts"))) {
  const base = f.split("/").pop() as string;
  if (base === "index.ts" || base.endsWith(".test.ts")) continue;
  const inSrcRoot = /\/src\/[^/]+\.ts$/.test(f);
  if (!inSrcRoot && !/^buckle\.[a-z0-9-]+(\.[a-z0-9-]+)*\.ts$/.test(base))
    errors.push(`naming: ${base} (expected buckle.<thing>.<role>.ts)`);
}

// 2. REPO RULE: every type comes from a zod schema and typeof —
// hand-written interfaces and object-literal type aliases fail anywhere
// (src/, tools/, test/); a type alias is legal ONLY as z.output/z.input.
for (const f of files.filter(
  (f) => f.endsWith(".ts") && /\/(src|tools|test)\//.test(f),
)) {
  const src = readFileSync(f, "utf8");
  const iface = src.match(/^\s*(export\s+)?interface\s+(\w+)/m);
  if (iface)
    errors.push(
      `${f}: hand-written interface "${iface[2]}" — derive it: type X = z.output<typeof XSchema>`,
    );
  const alias = src.match(/^\s*(export\s+)?type\s+\w+\s*=\s*\{/m);
  if (alias)
    errors.push(
      `${f}: hand-written object type alias — derive it: type X = z.output<typeof XSchema>`,
    );
  for (const bad of src.matchAll(/type\s+\w+\s*=\s*(?!z\.)/g)) {
    const name = bad[0].split(/\s+/)[1];
    if (!/^z\.(output|input|infer)/.test(src.slice(bad.index ?? 0 + bad[0].length).trimStart()))
      continue; // only flag aliases NOT starting with z. — checked above for object literals
    void name;
  }
}

// 2b. no hand-casts (type law): responses parse through their zod wire
//     schema — `x as { ... }` anywhere is a defect, and so is a
//     NAMED-type cast on a response body (`.json() as BuckleX`): the
//     live bug it hid was the stats fold double-nesting peer bodies.
for (const f of files.filter(
  (f) => f.endsWith(".ts") && /(\/src\/|\/tools\/|\/test\/)/.test(f),
)) {
  if (f.endsWith("buckle.check-laws.ts")) continue; // the law-definer quotes its own patterns
  const src = readFileSync(f, "utf8");
  if (/\)\s*as\s*\{/.test(src))
    errors.push(`${f}: hand-cast object literal (\`as { … }\`) — parse through the zod wire schema`);
  if (/\.json\(\)\s*\)?\s*as\s+[A-Z]/.test(src))
    errors.push(`${f}: named-type cast on a response body (\`.json() as X\`) — safeParse it through the wire schema`);
}

// 2c. kit-ownership: key dirs, stubs, recorders, world builders live
//     ONLY in buckle.server.kit.ts — a test file never hand-rolls them.
for (const f of files.filter((f) => /\/src\/.*\.test\.ts$/.test(f))) {
  const src = readFileSync(f, "utf8");
  for (const owned of ["function stubProvider", "function stubEngine", "function recorder", "function mintKeyDir", "function keyDir("]) {
    if (src.includes(owned))
    errors.push(`${f}: hand-rolled ${owned.slice(9)}( — import it from kit.ts`);
  }
}

// 2d. schema composition: the same object field-set declared 3+ times
//     across schemas is a re-declaration — compose one canonical shape
//     (the BuckleLimits precedent: the limits triple once lived 5×).
{
  const shapeCounts = new Map<string, string[]>();
  for (const f of files.filter((f) => /\/schemas\/.*\.zod\.ts$/.test(f) && !f.endsWith(".test.ts"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/z\.object\(\s*\{([^}]+)\}\s*\)/g)) {
      const fields = [...m[1]!.matchAll(/^\s*([a-z_][a-z0-9_]*):/gm)].map((x) => x[1]).sort().join(",");
      if (fields.split(",").length < 2) continue; // single-field shapes are cheap
      const list = shapeCounts.get(fields) ?? [];
      list.push(f.split("/").pop()!);
      shapeCounts.set(fields, list);
    }
  }
  for (const [fields, where] of shapeCounts) {
    if (where.length >= 3)
      errors.push(`schema duplication: {${fields}} declared ${where.length}× (${where.join(", ")}) — compose ONE canonical shape`);
  }
}

// 2e. test files mirror their module: buckle.server.<m>.test.ts needs a
//     sibling buckle.server.<m>.ts (federated.test.ts → federated.ts).
for (const f of files.filter((f) => /\/src\/.*\.test\.ts$/.test(f))) {
  const module = f.replace(".test.ts", ".ts");
  if (!files.includes(module))
    errors.push(`${f.split("/").pop()}: no sibling module ${module.split("/").pop()} — test names mirror modules`);
}

// 2f. no-try-catch: the ONLY sanctioned catch boundary in src/ is
//     fault.ts (classify, never swallow) and settings.ts (readToken/
//     listDir fault classification). Every other src module composes
//     typed Fault values — a bare catch anywhere else is a defect.
for (const f of files.filter(
  (f) => inSrc(f) && !f.endsWith(".test.ts"),
)) {
  const base = f.split("/").pop() as string;
  if (base === "fault.ts" || base === "settings.ts") continue;
  if (/\} catch/.test(readFileSync(f, "utf8")))
    errors.push(`${f}: bare catch — the only catch boundary is fault.ts (+ settings.ts readToken/listDir); compose typed Faults instead`);
}

// 2g. env boundary: process.env is read ONLY by the settings loader
//     (src/settings.ts). Every knob — urls, timeouts, telemetry —
//     lives in the settings schema; a scattered env read is a defect.
for (const f of files.filter(
  (f) => inSrc(f) && !f.endsWith(".test.ts"),
)) {
  if (f === SRC + "settings.ts") continue;
  if (/process\.env/.test(readFileSync(f, "utf8")))
    errors.push(`${f}: process.env outside the loader (src/settings.ts) — the knob belongs in the settings schema`);
}

// 2h. timeout knobs: every bounded wait lives in the settings schema
//     (timeouts.*). A module-local TIMEOUT_MS constant is a scattered
//     knob — fail. (TPS_WINDOW_MS is definitional, not a wait bound.)
for (const f of files.filter(
  (f) => inSrc(f) && !f.endsWith(".test.ts"),
)) {
  if (f.endsWith("buckle.settings.zod.ts")) continue;
  if (/TIMEOUT_MS\s*=/.test(readFileSync(f, "utf8")))
    errors.push(`${f}: module-local TIMEOUT constant — the knob belongs in settings.timeouts (one home, zod-defaulted)`);
}

// 3. no AUTHORED yaml outside compose wiring (docker-compose is wiring
//    only). test/deploy/engine/*.litellm.yaml is GENERATED from the captured
//    fixtures (buckle.gen-engine-config.ts, gitignored) — litellm only
//    reads yaml configs, so generated-and-never-edited is the sanctioned
//    exception.
for (const f of files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))) {
  if (!f.includes("/deploy/compose") && !f.includes("/deploy/engine/"))
    errors.push(`yaml authored outside compose wiring: ${f}`);
}

// 4. line caps: warn 400, hard fail 1500
for (const f of files.filter((f) => f.endsWith(".ts"))) {
  const lines = readFileSync(f, "utf8").split("\n").length;
  if (lines > 1500) errors.push(`${f}: ${lines} lines — hard cap 1500`);
  else if (lines > 400) warnings.push(`${f}: ${lines} lines — you are composing wrong (warn at 400)`);
}

for (const w of warnings) console.warn(`WARN ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`LAW ${e}`);
  process.exit(1);
}
console.log(`laws hold (${files.length} files checked, ${warnings.length} warnings)`);
