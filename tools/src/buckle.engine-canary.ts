// buckle.engine-canary.ts — OUTSIDE-process authenticated engine probe.
// positive: master key lists models (200); negative: anonymous and
// wrong key are 401/403. Usage: ENGINE_URL=http://engine:4000 \
//   ENGINE_KEY_FILE=/state/keys/engine.master.key bun this.ts
import { readFileSync } from "node:fs";

export type CanaryReceipt = { positive: number; anonymous: number; wrongKey: number; ok: boolean };

export async function runCanary(url: string, key: string): Promise<CanaryReceipt> {
  const get = async (auth?: string) =>
    (
      await fetch(`${url}/v1/models`, {
        headers: auth === undefined ? {} : { authorization: `Bearer ${auth}` },
        signal: AbortSignal.timeout(10_000),
      })
    ).status;
  const positive = await get(key);
  const anonymous = await get();
  const wrongKey = await get(`${key}-wrong`);
  const denied = (n: number) => n === 401 || n === 403 || n === 400; // litellm answers 400 for a malformed/tampered key — still a deny
  return { positive, anonymous, wrongKey, ok: positive === 200 && denied(anonymous) && denied(wrongKey) };
}

if (import.meta.main) {
  const url = process.env["ENGINE_URL"] ?? "http://engine:4000";
  const key = readFileSync(process.env["ENGINE_KEY_FILE"] ?? "/state/keys/engine.master.key", "utf8").trim();
  const r = await runCanary(url, key);
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}
