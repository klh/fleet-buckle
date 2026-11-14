// kit.ts — the ONE unit-test kit (the kit-ownership law:
// key dirs, stubs, recorders and world builders live HERE — a test
// file never hand-rolls them). Mirrors test/kit/, which serves the
// Docker projects; this kit serves the colocated bun unit tests.
// TYPE LAW: every exported type is zod-derived — no hand-written shapes.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { z } from "zod";
import { bootServer } from "./main.ts";
import { loadSettings } from "./settings.ts";
import { BuckleAccessRegistry } from "./schemas/buckle.access.zod.ts";
import {
  mergeSettings,
  type BuckleSettings,
} from "./schemas/buckle.settings.zod.ts";
import {
  HOP_DEADLINE_HEADER,
  HOP_PATH_HEADER,
  VERBATIM_HOP_HEADERS,
} from "./federation/buckle.federation.protocol.ts";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

export type AccessRegistry = ReturnType<typeof BuckleAccessRegistry.parse>;

/** what every stub/recorder records when a request rides in */
const SawRequest = z
  .object({
    auth: z.string().nullable(),
    traceparent: z.string().nullable(),
    hopPath: z.string().nullable(),
    deadline: z.string().nullable(),
    raw: z.string(),
  })
  .strict();
type SawRequest = z.output<typeof SawRequest>;

function sawOf(req: Request, raw: string): SawRequest {
  return SawRequest.parse({
    auth: req.headers.get("authorization"),
    traceparent: req.headers.get("traceparent"),
    hopPath: req.headers.get(HOP_PATH_HEADER),
    deadline: req.headers.get(HOP_DEADLINE_HEADER),
    raw,
  });
}

function verbatimHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = { "content-type": "application/json" };
  for (const h of VERBATIM_HOP_HEADERS) {
    const v = req.headers.get(h);
    if (v !== null) out[h] = v;
  }
  return out;
}

/** mint 0600 key/token files in a fresh tmp dir — secrets are paths */
export function mintKeyDir(entries: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "buckle-keys-"));
  for (const [name, value] of Object.entries(entries)) {
    const p = join(dir, name);
    writeFileSync(p, `${value}\n`);
    chmodSync(p, 0o600);
  }
  return dir;
}

/** a provider catalog stub: serves `rows` at /models, 404 elsewhere */
export function stubProvider(rows: { id: string }[]): {
  port: number;
  stop: () => void;
} {
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      if (new URL(req.url).pathname === "/models")
        return Response.json({ data: rows });
      return new Response("not found", { status: 404 });
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true) };
}

/** the engine stub: answers /v1/chat/completions with a well-formed
 *  body (id/usage/sleep parameterizable) and records the ride */
export function stubEngine(
  opts: { id?: string; totalTokens?: number; sleepMs?: number } = {},
): { port: number; stop: () => void; seen: SawRequest[] } {
  const seen: SawRequest[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      seen.push(sawOf(req, await req.text()));
      // the slow leg models a slow CHAT (the real engine answers
      // telemetry scrapes instantly — sleeping those would stall the
      // stats face's telemetry pull behind the chat it measures)
      const path = new URL(req.url).pathname;
      const isChat = path.endsWith("/chat/completions") || path.endsWith("/messages");
      if (opts.sleepMs !== undefined && isChat) await Bun.sleep(opts.sleepMs);
      return Response.json({
        id: opts.id ?? "engine-echo",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: opts.totalTokens ?? 2,
        },
      });
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true), seen };
}

/** a canned-body peer stub: answers every path with `body`, counts
 *  hits (federation folds ride this — cache/rollup tests) */
export function stubPeer(body: unknown): { port: number; stop: () => void; hits: number } {
  let hits = 0;
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      hits += 1;
      return Response.json(body);
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true), get hits() { return hits; } };
}

/** a transparent recorder: forwards every request VERBATIM to the
 *  target and records what rode in (token, trace, hop headers, body) */
export function recorder(target: number): {
  port: number;
  stop: () => void;
  seen: SawRequest[];
} {
  const seen: SawRequest[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const raw = await req.text();
      seen.push(sawOf(req, raw));
      return fetch(`http://127.0.0.1:${target}${new URL(req.url).pathname}`, {
        method: req.method,
        headers: verbatimHeaders(req),
        body: raw,
      });
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true), seen };
}

/** defaults only — the hermetic base every world composes from */
async function loadDefaultsOnly(): Promise<BuckleSettings> {
  return loadSettings({
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, "deploy/settings/default.settings.json5"),
  });
}

/** boot ONE buckle world: defaults ⊕ b1 ⊕ the overrides below, then
 *  bootServer on an ephemeral port. Hub tokens resolve to
 *  `<dir>/peer-<label>.token` (mint via mintKeyDir — secrets are
 *  paths). Callers own the stubs the world points at. */
/** a world provider: bare url (recognized labels resolve url+dialect
 *  from the registry) or the full entry — an UNKNOWN label needs its
 *  dialect explicit (the registry law: fail loud, never guess) */
export type WorldProvider = string | { url: string; dialect: "openai" | "anthropic" | "github_copilot" };

export async function bootBuckle(opts: {
  label: string;
  dir: string;
  access: AccessRegistry;
  providers: Record<string, WorldProvider>;
  hubs?: Record<string, string>;
  engineUrl?: string;
  /** path to the engine master key file — when set, worlds exercise
   *  the engine gate (litellm master_key auth on the engine leg) */
  engineKeyFile?: string;
}): Promise<{ base: string; port: number; stop: () => void }> {
  const base = await loadDefaultsOnly();
  // compose as a RAW overlay, re-parsed through the one loader — the
  // provider registry resolves url/dialect at parse, never by cast.
  // HERMETIC: providers/hubs are exactly the world's opts — nothing
  // real, nothing docker, nothing inherited
  const settings = mergeSettings(base, {
    hub: { label: opts.label },
    keys: {
      principals_dir: opts.dir,
      ...(opts.engineKeyFile !== undefined ? { engine: opts.engineKeyFile } : {}),
    },
    access: opts.access,
    hubs: Object.fromEntries(
      Object.entries(opts.hubs ?? {}).map(([label, url]) => [
        label,
        { url, token_file: join(opts.dir, `peer-${label}.token`) },
      ]),
    ),
    providers: Object.fromEntries(
      Object.entries(opts.providers).map(([label, entry]) => [
        label,
        typeof entry === "string" ? { url: entry } : entry,
      ]),
    ),
    ...(opts.engineUrl === undefined
      ? {}
      : { engine: { url: opts.engineUrl } }),
  });
  const server = bootServer({ settings, port: 0 });
  return {
    base: `http://127.0.0.1:${server.port}`,
    port: server.port ?? 0,
    stop: () => server.stop(true),
  };
}
