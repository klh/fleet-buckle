// kit.ts — the ONE unit-test kit (the kit-ownership law:
// key dirs, stubs, recorders and world builders live HERE — a test
// file never hand-rolls them). Mirrors test/kit/, which serves the
// Docker projects; this kit serves the colocated bun unit tests.
// TYPE LAW: every exported type is zod-derived — no hand-written shapes.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { z } from "zod";
import { bootServer } from "./main.ts";
import { loadSettings } from "./settings.ts";
import { BuckleAccessRegistry } from "./schemas/buckle.access.zod.ts";
import { mergeSettings, type BuckleSettings } from "./schemas/buckle.settings.zod.ts";
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
    /** the copilot seat's demanded integration id (BYOC proofs) */
    copilotId: z.string().nullable(),
    /** the request path (chat vs catalog rides, engine-leg proofs) */
    path: z.string(),
  })
  .strict();
type SawRequest = z.output<typeof SawRequest>;

function sawOf(req: Request, raw: string): SawRequest {
  return SawRequest.parse({
    auth: req.headers.get("authorization"),
    traceparent: req.headers.get("traceparent"),
    hopPath: req.headers.get(HOP_PATH_HEADER),
    deadline: req.headers.get(HOP_DEADLINE_HEADER),
    copilotId: req.headers.get("copilot-integration-id"),
    path: new URL(req.url).pathname,
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
      if (new URL(req.url).pathname === "/models") return Response.json({ data: rows });
      return new Response("not found", { status: 404 });
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true) };
}

/** a BYOC seat stub — the copilot-shaped provider: the /models
 *  catalog PLUS direct /v1/chat/completions + /v1/messages legs
 *  (the user leg posts the provider DIRECT, no engine between),
 *  every ride recorded with the headers that arrived (the BYOC
 *  proof reads exactly which credential reached the seat) */
export function stubByocSeat(rows: { id: string }[]): {
  port: number;
  stop: () => void;
  seen: SawRequest[];
} {
  const seen: SawRequest[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const pathname = new URL(req.url).pathname;
      if (req.method === "GET" && pathname === "/models")
        return Response.json({ data: rows });
      if (req.method === "POST" && (pathname === "/v1/chat/completions" || pathname === "/v1/messages")) {
        seen.push(sawOf(req, await req.text()));
        return Response.json({
          id: "copilot-seat-echo",
          object: "chat.completion",
          created: 1,
          model: "seat",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { port: server.port ?? 0, stop: () => server.stop(true), seen };
}

/** the engine stub: answers /v1/chat/completions with a well-formed
 *  body (id/usage/sleep parameterizable) and records the ride */
export function stubEngine(opts: { id?: string; totalTokens?: number; sleepMs?: number } = {}): {
  port: number;
  stop: () => void;
  seen: SawRequest[];
} {
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
  return {
    port: server.port ?? 0,
    stop: () => server.stop(true),
    get hits() {
      return hits;
    },
  };
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

/** the loaded defaults face parses through a NAMED schema (zod law —
 *  the dynamic json5 import is wire-shaped input, never a hand cast) */
const LoadedDefaultsSchema = z.object({ default: z.record(z.string(), z.unknown()) });

/** defaults only — the hermetic base every world composes from.
 *  Engineless worlds (engineUrl undefined) STRIP the engine url and
 *  key path from the RAW defaults layer first: deep-merge cannot
 *  delete, so the strip happens before the one parse. */
async function loadDefaultsRaw(engineless: boolean): Promise<Record<string, unknown>> {
  const mod = LoadedDefaultsSchema.parse(
    await import(join(ROOT, "deploy/settings/default.settings.json5"), {
      with: { type: "json5" },
    }),
  );
  const raw = structuredClone(mod.default);
  if (engineless) {
    delete raw["engine"];
    const keys = raw["keys"];
    if (typeof keys === "object" && keys !== null && !Array.isArray(keys)) {
      delete (keys as Record<string, unknown>)["engine"];
    }
  }
  return raw;
}

/** boot ONE buckle world: defaults ⊕ b1 ⊕ the overrides below, then
 *  bootServer on an ephemeral port. Hub tokens resolve to
 *  `<dir>/peer-<label>.token` (mint via mintKeyDir — secrets are
 *  paths). Callers own the stubs the world points at. */
/** a world provider: bare url (recognized labels resolve url+dialect
 *  from the registry) or the full entry — an UNKNOWN label needs its
 *  dialect explicit (the registry law: fail loud, never guess) */
export type WorldProvider =
  string | { url: string; dialect: "openai" | "anthropic" | "github_copilot" };

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
  /** over-layer path — when set, the world boots WITH an over layer
   *  (and /admin/hubs can land edits through it) */
  over?: string;
}): Promise<{ base: string; port: number; stop: () => void }> {
  // compose as a RAW overlay, re-parsed through the one loader — the
  // provider registry resolves url/dialect at parse, never by cast.
  // HERMETIC: providers/hubs are exactly the world's opts — nothing
  // real, nothing docker, nothing inherited
  const overlay = {
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
    ...(opts.engineUrl === undefined ? {} : { engine: { url: opts.engineUrl } }),
  };
  // with an over path the world RIDES the over layer (the exact
  // mechanism /admin/hubs lands edits through — reload reproduces
  // the same settings); without one it composes in memory. The unit
  // layer is a WRITTEN copy of the (possibly engine-stripped) raw
  // defaults so reloads reproduce exactly what the world booted with
  const rawBase = await loadDefaultsRaw(opts.engineUrl === undefined);
  let settings: BuckleSettings;
  const overPath = opts.over;
  if (overPath === undefined) {
    settings = mergeSettings(rawBase, overlay);
  } else {
    const unitPath = join(dirname(overPath), "unit.json5");
    writeFileSync(unitPath, `${JSON.stringify(rawBase, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(overPath, `${JSON.stringify(overlay, null, 2)}\n`, { mode: 0o600 });
    settings = await loadSettings({ defaults: unitPath, settings: unitPath, over: overPath });
  }
  const server = bootServer({
    settings,
    port: 0,
    ...(overPath === undefined
      ? {}
      : { paths: { defaults: join(dirname(overPath), "unit.json5"), settings: join(dirname(overPath), "unit.json5"), over: overPath } }),
  });
  return {
    base: `http://127.0.0.1:${server.port}`,
    port: server.port ?? 0,
    stop: () => server.stop(true),
  };
}
