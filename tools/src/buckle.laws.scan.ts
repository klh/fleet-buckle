// buckle.laws.scan.ts — the file scanner the law checks ride on: the
// repo walk and the shape filters (which files each law's domain
// covers). Zero policy lives here — pure listing.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const root = new URL("../../", import.meta.url).pathname;
export const SRC = join(root, "src") + "/";

/** every ts/json5/yaml file in the repo, minus vendored/dot trees */
export function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else files.push(p);
  }
  return files;
}

export const tsFiles = (files: string[]): string[] =>
  files.filter((f) => f.endsWith(".ts") && /\/(src|tools|test)\//.test(f));
export const srcOrToolsTs = (files: string[]): string[] =>
  files.filter((f) => f.endsWith(".ts") && /\/(src|tools)\//.test(f));
export const srcModules = (files: string[]): string[] =>
  files.filter((f) => f.startsWith(SRC) && !f.endsWith(".test.ts"));
export const srcTests = (files: string[]): string[] =>
  files.filter((f) => /\/src\/.*\.test\.ts$/.test(f));
