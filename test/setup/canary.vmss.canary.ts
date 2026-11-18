// OPT-IN live VMSS canary (BUCKLE_CANARY=1 + BUCKLE_CANARY_URL + BUCKLE_CANARY_KEY).
// Never part of the hermetic graph; absent opt-in it is skipped, not green.
import { expect, test } from "@playwright/test";
import { z } from "zod";

test.skip(process.env["BUCKLE_CANARY"] !== "1", "live VMSS canary is opt-in (BUCKLE_CANARY=1)");

test("canary: live gateway serves the requested model", async () => {
  const url = process.env["BUCKLE_CANARY_URL"];
  const key = process.env["BUCKLE_CANARY_KEY"];
  const model = process.env["BUCKLE_CANARY_MODEL"] ?? "qwen/qwen3.8-max-prime";
  if (url === undefined || key === undefined) throw new Error("BUCKLE_CANARY_URL/KEY required");
  const r = await fetch(`${url.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "canary" }] }),
  });
  expect(r.status).toBe(200);
  const body = z.object({ model: z.string().optional() }).safeParse(await r.json());
  expect(body.success && body.data.model).toBe(model);
});
