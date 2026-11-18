import { describe, expect, test } from "bun:test";
import { mayAttempt, retryAfterSeconds, retryableBeforeFirstChunk, MAX_ATTEMPTS } from "./fault.ts";
import { interruptibleStream } from "./proxy/buckle.proxy.settle.ts";
import { mergeSettings } from "./schemas/buckle.settings.zod.ts";

describe("B05 attempt policy", () => {
  test("one bounded attempt; no attempt after deadline", () => {
    expect(MAX_ATTEMPTS).toBe(1);
    expect(mayAttempt(0, Date.now() + 1000)).toBe(true);
    expect(mayAttempt(1, Date.now() + 1000)).toBe(false);
    expect(mayAttempt(0, Date.now() - 1)).toBe(false);
  });
  test("classifier: only pre-chunk transport faults are retryable", () => {
    expect(retryableBeforeFirstChunk({ kind: "timeout" })).toBe(true);
    expect(retryableBeforeFirstChunk({ kind: "unreachable" })).toBe(true);
    expect(retryableBeforeFirstChunk({ kind: "malformed", detail: "x" })).toBe(false);
  });
  test("Retry-After honored, garbage → 1, capped", () => {
    expect(retryAfterSeconds("7")).toBe(7);
    expect(retryAfterSeconds("abc")).toBe(1);
    expect(retryAfterSeconds(null)).toBe(1);
    expect(retryAfterSeconds("99999")).toBe(300);
  });
  test("timeout knobs default measured: engine/hop 120s, server_idle_s 0", () => {
    const t = mergeSettings({ hub: { label: "t" } }, {}).timeouts;
    expect(t.engine_ms).toBe(120_000);
    expect(t.hop_ms).toBe(120_000);
    expect(t.server_idle_s).toBe(0);
  });
  test("mid-stream failure → interrupted event, no [DONE]", async () => {
    let n = 0;
    const src = new ReadableStream<Uint8Array>({
      pull(c) {
        if (n++ === 0) c.enqueue(new TextEncoder().encode("data: {}\n\n"));
        else c.error(new Error("boom"));
      },
    });
    const text = await new Response(interruptibleStream(src)).text();
    expect(text).toContain("interrupted");
    expect(text).not.toContain("[DONE]");
  });
});
