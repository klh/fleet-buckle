// worker.wake.ts — the WAKE face: a verified webhook POST becomes a
// durable kick task (worker.durable.ts). The hand-rolled
// sleepOrWake loop this module used to own is gone — sleepUntil +
// the harness scheduler own the timing; the poll task stays the
// reconciliation backstop (wakes are at-least-once, sweeps are
// idempotent). Only the signature is authoritative; the payload is
// advisory — the sweep re-reads REST truth.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./worker.env.ts";
import { kick, KickInputSchema, type DurableRuntime } from "./worker.durable.ts";

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

const wakeResponse = async (harness: DurableRuntime, req: Request): Promise<Response> => {
  const raw = await req.text();
  if (!signed(req, raw)) return new Response("bad signature", { status: 403 });
  const event = req.headers.get("x-github-event") ?? "wake";
  console.log(`[worker] wake: ${event} ${advisoryAction(raw)}`);
  const input = KickInputSchema.safeParse({
    requestId: createHash("sha256").update(raw).digest("hex"),
    event,
  });
  if (!input.success) return new Response("bad input", { status: 400 });
  await kick(harness, input.data);
  return Response.json({ ok: true });
};

/** boot the wake face when WAKE_ADDR is set (host:port). Each signed
 *  POST admits one durable kick task; a wake during a running sweep
 *  waits at the gate — never interrupts a sweep mid-flight. */
export function serveWake(harness: DurableRuntime): void {
  if (env.wakeAddr === "") return;
  const [hostname, portText] = env.wakeAddr.split(":");
  Bun.serve({
    hostname: hostname ?? "0.0.0.0",
    port: Number(portText ?? "8090"),
    fetch: async (req) => {
      if (req.method !== "POST" || new URL(req.url).pathname !== "/wake")
        return new Response("not found", { status: 404 });
      return await wakeResponse(harness, req);
    },
  });
}
