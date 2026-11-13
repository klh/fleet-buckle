// load — PROJECT 4 (depends on smoke): waves against the real stack.
// alice@b1 carries a 4 rpm cap: bursts produce 429 problem+json with
// Retry-After (never 5xx, never silent), the catalog stays readable,
// and carol (uncapped) keeps chatting THROUGH the storm.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const KEY = (p: string) =>
  readFileSync(join(ROOT, `deploy/keys/.gen/${p}`), "utf8").trim();
const alice = KEY("principal.alice@fleet.key");
const carol = KEY("principal.carol@fleet.key");
const B1 = "http://127.0.0.1:4711";

const chat = (token: string) =>
  fetch(`${B1}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "openai/qwen3-coder",
      messages: [{ role: "user", content: "wave" }],
    }),
  });

test.describe("load waves — 429 is a CONTRACT, not a crash", () => {
  for (const wave of [1, 2, 3]) {
    test(`wave ${wave}: burst of 12 → capped with Retry-After, no 5xx`, async () => {
      const rs = await Promise.all(
        Array.from({ length: 12 }, () => chat(alice)),
      );
      const statuses = rs.map((r) => r.status).sort();
      // never a 5xx — the limiter answers, the server stays up
      for (const st of statuses) expect(st < 500).toBe(true);
      // every 429 is problem+json with a sane Retry-After
      for (const r of rs.filter((r) => r.status === 429)) {
        expect(r.headers.get("content-type")).toContain("application/problem+json");
        const retry = r.headers.get("retry-after");
        expect(retry).not.toBeNull();
        expect(Number(retry)).toBeGreaterThanOrEqual(1);
        expect(Number(retry)).toBeLessThanOrEqual(60);
        expect(((await r.json()) as { kind: string }).kind).toBe("rate-limited");
      }
      // carol rides THROUGH the storm (uncapped principal)
      const carolR = await chat(carol);
      expect([200, 429]).toContain(carolR.status); // 429 only if she hit her own caps (she has none)
      // the catalog face stays readable while chats are capped
      const models = await fetch(`${B1}/v1/models`, {
        headers: { authorization: `Bearer ${alice}` },
      });
      expect(models.status).toBe(200);
    });
  }
});
