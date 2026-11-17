import { test } from "@playwright/test";
import { stackDown } from "../kit/buckle.kit.stack.ts";

test("stop the shared Docker stack", () => {
  stackDown();
});
