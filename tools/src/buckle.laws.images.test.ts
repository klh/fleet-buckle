import { expect, test } from "bun:test";
import { checkLitellmDigest } from "./buckle.laws.images.ts";
import { createLawsCtx } from "./buckle.laws.shapes.ts";

const run = (body: string) => {
  const ctx = createLawsCtx();
  checkLitellmDigest(ctx, ["/r/deploy/compose.x.yaml"], () => body);
  return ctx.errors;
};
test("floating tag fails", () => {
  expect(run("    image: ghcr.io/berriai/litellm:v1.103.0\n").length).toBe(1);
  expect(run("    image: ghcr.io/berriai/litellm:latest\n").length).toBe(1);
});
test("digest ref passes", () => {
  expect(run(`    image: ghcr.io/berriai/litellm@sha256:${"a".repeat(64)}\n`)).toEqual([]);
});
