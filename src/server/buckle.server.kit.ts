// buckle.server.kit.ts — the ONE unit-test kit (the kit-ownership law:
// key dirs, stubs, recorders and world builders live HERE — a test
// file never hand-rolls them). Mirrors test/kit/, which serves the
// Docker projects; this kit serves the colocated bun unit tests.
// TYPE LAW: every exported type is zod-derived — no hand-written shapes.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { z } from "zod";
import { bootServer } from "./buckle.server.main.ts";
import { loadSettings } from "./buckle.server.settings.ts";
import { BuckleAccessRegistry } from "../schemas/buckle.access.zod.ts";
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export type AccessRegistry = ReturnType<typeof BuckleAccessRegistry.parse>;

/** what every stub/recorder records when a request rides in */
export const SawRequest = z
  .object({
    auth: z.string().nullable(),
    traceparent: z.string().nullable(),
    hopPath: z.string().nullable(),
    deadline: z.string().nullable(),
    raw: z.string(),
  })
  .strict();
export type SawRequest = z.output<typeof SawRequest>;

function sawOf(req: Request, raw: string): SawRequest {
  return {
    auth: req.headers.get("authorization"),
    traceparent: req.headers.get("traceparent"),
    hopPath: req.headers.get("x-fleet-buckle-hop-path"),
    deadline: req.headers.get("x-fleet-buckle-deadline-ms"),
    raw,
  };
}

/** the hop headers a proxy forwards verbatim */
const VERBATIM = [
  "traceparent",
  "authorization",
  "x-fleet-buckle-hop-path",
  "x-fleet-buckle-deadline-ms",
] as const;

function verbatimHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = { "content-type": "application/json" };
  for (const h of VERBATIM) {
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

/** a provider /v1/models stub: serves `rows` verbatim, 404 elsewhere */
export function stubProvider(rows: { id: string }[]): {
  port: number;
  stop: () => void;
} {
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      if (new URL(req.url).pathname === "/v1/models")
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
      if (opts.sleepMs !== undefined) await Bun.sleep(opts.sleepMs);
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

/** defaults ⊕ b1 — the base every unit world composes from */
export async function loadBaseSettings(): Promise<BuckleSettings> {
  return loadSettings({
    defaults: join(ROOT, "deploy/settings/default.settings.json5"),
    settings: join(ROOT, "deploy/settings/b1.settings.json5"),
  });
}

/** boot ONE buckle world: defaults ⊕ b1 ⊕ the overrides below, then
 *  bootServer on an ephemeral port. Hub tokens resolve to
 *  `<dir>/peer-<label>.token` (mint via mintKeyDir — secrets are
 *  paths). Callers own the stubs the world points at. */
export async function bootBuckle(opts: {
  label: string;
  dir: string;
  access: AccessRegistry;
  providers: Record<string, string>;
  hubs?: Record<string, string>;
  engineUrl?: string;
}): Promise<{ base: string; port: number; stop: () => void }> {
  const base = await loadBaseSettings();
  const settings: BuckleSettings = {
    ...base,
    hub: { ...base.hub, label: opts.label },
    keys: { ...(base.keys ?? {}), principals_dir: opts.dir },
    access: opts.access,
    hubs: Object.fromEntries(
      Object.entries(opts.hubs ?? {}).map(([label, url]) => [
        label,
        { url, token_file: join(opts.dir, `peer-${label}.token`) },
      ]),
    ),
    providers: Object.fromEntries(
      Object.entries(opts.providers).map(([label, url]) => [label, { url }]),
    ),
    ...(opts.engineUrl === undefined
      ? {}
      : { engine: { url: opts.engineUrl } }),
  };
  const server = bootServer({ settings, port: 0 });
  return {
    base: `http://127.0.0.1:${server.port}`,
    port: server.port ?? 0,
    stop: () => server.stop(true),
  };
}
