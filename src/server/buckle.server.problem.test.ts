// buckle.server.problem.test.ts — the scrub guard (port doctrine #4):
// hop outcomes RELAY peer-provided text into client-facing problem
// details, so secret shapes and home paths must never ride an error.
import { describe, expect, test } from "bun:test";
import { problemResponse, scrubDetail } from "./buckle.server.problem.ts";

describe("the scrub guard — secrets never ride errors", () => {
  test("key/token shapes redact, home paths tilde", () => {
    expect(scrubDetail("key sk-abcdef1234567890 leaked")).toBe(
      "key [redacted] leaked",
    );
    expect(scrubDetail("lane bksk_deadbeefdeadbeef")).toBe("lane [redacted]");
    expect(scrubDetail("pat ghp_AbCdEfGh1234567890")).toBe("pat [redacted]");
    expect(scrubDetail("aws AKIAIOSFODNN7EXAMPLE")).toBe("aws [redacted]");
    expect(scrubDetail("Bearer abcdefghijklmnop q")).toBe("[redacted] q");
    expect(scrubDetail("at /Users/kk/secret then ok")).toBe(
      "at ~/secret then ok",
    );
    expect(scrubDetail("clean operator-facing text stays")).toBe(
      "clean operator-facing text stays",
    );
  });

  test("problemResponse scrubs the detail it serves", async () => {
    const r = problemResponse(
      "unavailable",
      "peer refused the hop",
      "status 500 — Bearer sk-abcdef1234567890 at /Users/kk/x.json",
    );
    expect(r.headers.get("content-type")).toContain("application/problem+json");
    const body = (await r.json()) as { detail: string };
    expect(body.detail).toBe("status 500 — [redacted] at ~/x.json");
  });
});
