import { test } from "@playwright/test";
import { stackDown } from "../kit/buckle.kit.stack.ts";

test("graph teardown: remove the hermetic stack and volumes", () => {
  stackDown();
});
