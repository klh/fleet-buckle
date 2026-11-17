// buckle.laws.images.ts — litellm images are pinned by digest, never by
// a floating tag (review finding #13).
import { readFileSync } from "node:fs";
import type { LawsCtx } from "./buckle.laws.shapes.ts";

export type FileRead = (f: string) => string;

export function checkLitellmDigest(
  ctx: LawsCtx,
  files: string[],
  read: FileRead = (f) => readFileSync(f, "utf8"),
): void {
  for (const f of files.filter((f) => /\.ya?ml$/.test(f))) {
    read(f).split("\n").forEach((line, i) => {
      if (/berriai\/litellm/.test(line) && !/^\s*#/.test(line) && !/berriai\/litellm@sha256:[0-9a-f]{64}/.test(line))
        ctx.errors.push(`${f}:${i + 1}: litellm image must be pinned @sha256:<digest>, not a floating tag`);
    });
  }
}
