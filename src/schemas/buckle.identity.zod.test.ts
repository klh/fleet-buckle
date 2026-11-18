import { expect, test } from "bun:test";
import { BuckleEngineIdentity } from "./buckle.identity.zod.ts";

const ok = { principalId: "alice@fleet", kind: "human", engineKeyRef: "k1", routeFamilies: ["chat"] };
test("identity valid + defaults", () => {
  const r = BuckleEngineIdentity.parse(ok);
  expect(r.teams).toEqual([]);
});
test("identity denied/malformed", () => {
  expect(BuckleEngineIdentity.safeParse({ ...ok, principalId: "Alice" }).success).toBe(false);
  expect(BuckleEngineIdentity.safeParse({ ...ok, kind: "root" }).success).toBe(false);
  expect(BuckleEngineIdentity.safeParse({ ...ok, routeFamilies: [] }).success).toBe(false);
  expect(BuckleEngineIdentity.safeParse({ ...ok, engineKey: "sk-raw" }).success).toBe(false);
});
