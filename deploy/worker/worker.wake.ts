// worker.wake.ts — the WAKE compartment: the only hand-rolled timing
// in the service. A verified webhook POST resolves the sleep early;
// the poll tick stays the backstop (wakes are at-least-once, sweeps
// are idempotent). A wake DURING a sweep (no pending sleep) sets the
// flag — the next sleepOrWake returns immediately, no event lost.
// THE DURABLE REWORK REPLACES THIS ENTIRE MODULE: sleepUntil +
// onWake/resume() own the timing, this file shrinks to the signature
// verification, and nothing else in the service changes.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./worker.env.ts";

let wakePending = false;
let wakeResolve: (() => void) | null = null;

export const sleepOrWake = (): Promise<void> =>
  new Promise<void>((resolve) => {
    wakeResolve = resolve;
    if (wakePending) {
      wakePending = false;
      resolve();
      return;
    }
    setTimeout(resolve, env.pollSeconds * 1000);
  });

const signed = (req: Request, raw: string): boolean => {
  if (env.webhookSecret === "") return false;
  const got = req.headers.get("x-hub-signature-256") ?? "";
  const want = `sha256=${createHmac("sha256", env.webhookSecret).update(raw).digest("hex")}`;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** payload action — advisory only (castless in-guard), the sweep
 *  re-reads REST truth; only the signature is authoritative */
const advisoryAction = (raw: string): string => {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === "object" && v !== null && "action" in v && typeof v.action === "string")
      return v.action;
  } catch {
    // unparsable payload: still a valid wake if signed
  }
  return "";
};

const fireWake = (): void => {
  if (wakeResolve !== null) {
    const fire = wakeResolve;
    wakeResolve = null;
    fire();
    return;
  }
  wakePending = true;
};

const wakeResponse = async (req: Request): Promise<Response> => {
  const raw = await req.text();
  if (!signed(req, raw)) return new Response("bad signature", { status: 403 });
  const event = req.headers.get("x-github-event") ?? "wake";
  console.log(`[worker] wake: ${event} ${advisoryAction(raw)}`);
  fireWake();
  return Response.json({ ok: true });
};

/** boot the wake face when WAKE_ADDR is set (host:port). The payload
 *  shape is advisory — the sweep re-reads REST truth; only the
 *  signature is authoritative. */
export function serveWake(): void {
  if (env.wakeAddr === "") return;
  const [hostname, portText] = env.wakeAddr.split(":");
  Bun.serve({
    hostname: hostname ?? "0.0.0.0",
    port: Number(portText ?? "8090"),
    fetch: async (req) => {
      if (req.method !== "POST" || new URL(req.url).pathname !== "/wake")
        return new Response("not found", { status: 404 });
      return await wakeResponse(req);
    },
  });
}
