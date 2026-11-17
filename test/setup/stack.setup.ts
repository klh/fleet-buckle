import { test } from "@playwright/test";
import { stackUp } from "../kit/buckle.kit.stack.ts";

test("boot the shared Docker stack", async () => {
  await stackUp();
});
