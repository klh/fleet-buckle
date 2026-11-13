// front.main.ts — the per-unit FRONT: a tiny reverse proxy that makes
// rolling deploys possible. The active upstream (a buckle VERSION) is
// a state file, re-read per request: flipping the file is the switch.
// In-flight requests ride their chosen upstream to completion; the old
// version stays up until drained. Responses carry x-buckle-upstream so
// the switch is observable from the client side.
import { readFileSync } from "node:fs";

const port = Number(process.env.FRONT_PORT ?? 4113);
const statePath = process.env.FRONT_STATE ?? "/state/active.json";

type Active = { upstream: string };

/** the last VALID upstream — a torn or missing state read serves this
 * instead of dropping the request (the flip lands on the next good
 * read). Null only before the first good read, ever. */
let lastKnown: Active | null = null;

function active(): Active | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Active).upstream === "string"
    ) {
      lastKnown = parsed as Active;
      return lastKnown;
    }
  } catch {
    // torn read / missing file — fall through to last-known-good
  }
  return lastKnown;
}

const server = Bun.serve({
  hostname: "0.0.0.0",
  port,
  fetch: async (req) => {
    const a = active();
    if (a === null)
      return new Response("front: no active upstream configured", {
        status: 502,
      });
    const { pathname, search } = new URL(req.url);
    try {
      const upstream = new URL(a.upstream);
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : req.body;
      const r = await fetch(`${upstream.origin}${pathname}${search}`, {
        method: req.method,
        headers: req.headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      return new Response(r.body, {
        status: r.status,
        headers: { ...r.headers, "x-buckle-upstream": a.upstream },
      });
    } catch {
      return new Response(`front: upstream unreachable (${a.upstream})`, {
        status: 502,
      });
    }
  },
});
console.log(`front on :${port} — active upstream read per request from ${statePath}`);
void server;
