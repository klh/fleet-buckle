// buckle.server.main.test.ts — STEP 1 (test-first): boot the server on
// merged settings; /healthz answers the BuckleHealthz contract — ok,
// up, the hub label, and a W3C trace id on the answer.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootServer } from "./buckle.server.main.ts";
import { loadSettings } from "./buckle.server.settings.ts";
import { BuckleHealthz } from "../schemas/buckle.healthz.zod.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("STEP 1 — the healthz face", () => {
  test("boots on default ⊕ b1 settings; /healthz = ok, up, label, trace id", async () => {
    const settings = await loadSettings({
      defaults: join(ROOT, "deploy/settings/default.settings.json5"),
      settings: join(ROOT, "deploy/settings/b1.settings.json5"),
    });
    const server = bootServer({ settings, port: 0 });
    try {
      const r = await fetch(`http://127.0.0.1:${server.port}/healthz`);
      expect(r.status).toBe(200);
      const health = BuckleHealthz.parse(await r.json());
      expect(health.ok).toBe(true);
      expect(health.status).toBe("up");
      expect(health.label).toBe("b1");
      expect(health.trace_id).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      server.stop(true);
    }
  });
});
