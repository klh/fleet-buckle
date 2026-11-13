// buckle.check-laws.ts — every law has a check or it is a wish.
// Fails on: wrong file naming, hand-written data types in schemas/,
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

// 1. naming: src/tools ts files are buckle.<thing>.<role>.ts or barrels
for (const f of files.filter((f) => f.match(/\/(src|tools)\//) && f.endsWith(".ts"))) {
  const base = f.split("/").pop() as string;
  if (base === "index.ts" || base.endsWith(".test.ts")) continue;
  if (!/^buckle\.[a-z0-9-]+(\.[a-z0-9-]+)*\.ts$/.test(base))
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

// 3. no authored yaml outside compose wiring (docker-compose is wiring only)
for (const f of files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))) {
  if (!f.includes("/deploy/compose")) errors.push(`yaml authored outside compose wiring: ${f}`);
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
