// worker.prefer.test.ts — the picker contract: parse (fleet .prefer
// vocabulary, kebab/snake key normalize, later lines append, hub-url
// validation, LOWERCASING), tier walk (must fatal / prefer falls
// through / defaults baked / first probe win takes the seat), and the
// case law (lowercase tokens → original catalog casing on requests).
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  DEFAULT_MODELS,
  parsePrefer,
  pickHub,
  pickModel,
  type Prober,
} from "./worker.prefer.ts";
import { ask, setPersona, setTemplate } from "./worker.model.ts";
import { fetchCatalog } from "./worker.probe.ts";

const SimpleSchema = z.object({ ok: z.boolean() });

// DEFAULT_MODELS[0] under noUncheckedIndexedAccess: always set,
// TS needs the narrowing for the defaults-fallthrough test
const FIRST_DEFAULT = DEFAULT_MODELS[0] ?? "";

const file = `# the startup file
hub-url=http://buckle:4111, http://buckle2:4111
must=GPT-5.3-Codex, Claude-Sonnet-5.5
prefer=gpt-6-luna
can=gpt-4o
tag=repoagent-v1
color=#0af
max_tokens=512
max_loops=4
not-a-key=x
`;

const noCatalog = new Map<string, string>();

describe("parsePrefer", () => {
  test("parses the full vocabulary, LOWERCASING every list token", () => {
    const p = parsePrefer(file);
    expect(p.must).toEqual(["gpt-5.3-codex", "claude-sonnet-5.5"]);
    expect(p.prefer).toEqual(["gpt-6-luna"]);
    expect(p.can).toEqual(["gpt-4o"]);
    expect(p.hubUrls).toEqual(["http://buckle:4111", "http://buckle2:4111"]);
    expect(p.tag).toBe("repoagent-v1");
    expect(p.color).toBe("#0af");
    expect(p.maxTokens).toBe(512);
    expect(p.maxLoops).toBe(4);
  });

  test("snake_case keys normalize to the same knobs; 0 stays unlimited", () => {
    const p = parsePrefer("max_tokens=0\nmax_loops=0\nmax-tokens=7");
    expect(p.maxTokens).toBe(7);
    expect(p.maxLoops).toBe(0);
  });

  test("later lines append; bare hub labels park in hubLabels, urls validate", () => {
    const p = parsePrefer("prefer=a\nprefer=B\nhub=nas\nhub-url=ftp://nope,http://yes");
    expect(p.prefer).toEqual(["a", "b"]);
    // non-http tokens cannot be hub candidates — they park visibly
    expect(p.hubLabels).toEqual(["nas", "ftp://nope"]);
    expect(p.hubUrls).toEqual(["http://yes"]);
  });

  test("provider= lowercases alongside the model tokens", () => {
    const p = parsePrefer("hub=ikea\nprovider=MSCopilot\nprefer=gpt-6.1-sol");
    expect(p.provider).toBe("mscopilot");
    expect(parsePrefer("hub=ikea").provider).toBe(""); // unscoped = every provider
  });

  test("empty/comment-only files parse to the unlimited empty prefer", () => {
    const p = parsePrefer("\n# nothing\n");
    expect(p.must).toEqual([]);
    expect(p.maxTokens).toBe(0);
  });
});

describe("pickModel", () => {
  const probeFor = (ok: (model: string) => boolean): Prober => {
    return async (_hub, model) => ok(model);
  };

  test("first WORKING must model wins, in listing order", async () => {
    const pick = await pickModel(
      parsePrefer(file),
      { url: "http://h", label: "test" },
      probeFor((m) => m === "claude-sonnet-5.5"),
      noCatalog,
    );
    expect(pick).toEqual({
      model: "claude-sonnet-5.5",
      hub: "http://h",
      hubLabel: "test",
      provider: "",
      tier: "must",
      maxTokens: 512,
      tag: "repoagent-v1",
      color: "#0af",
    });
  });

  test("case law: requests use the catalog's ORIGINAL casing", async () => {
    const catalog = new Map([["gpt-5.3-codex", "GPT-5.3-CODEX"]]);
    const seen: string[] = [];
    const pick = await pickModel(
      parsePrefer("must=GPT-5.3-Codex"),
      { url: "http://h", label: "test" },
      async (_h, model) => {
        seen.push(model);
        return true;
      },
      catalog,
    );
    expect(seen).toEqual(["GPT-5.3-CODEX"]);
    expect(pick.model).toBe("GPT-5.3-CODEX");
  });

  test("must exhaustion is fatal — the worker never guesses past a pin", async () => {
    await expect(
      pickModel(parsePrefer(file), { url: "http://h", label: "test" }, probeFor(() => false), noCatalog),
    ).rejects.toThrow(/must list exhausted/);
  });

  test("prefer falls through to can, then to the baked defaults (lowercased)", async () => {
    const p = parsePrefer("prefer=gpt-6-luna\ncan=gpt-4o");
    const pick = await pickModel(
      p,
      { url: "http://h", label: "test" },
      probeFor((m) => m === FIRST_DEFAULT),
      noCatalog,
    );
    expect(pick.tier).toBe("default");
    expect(pick.model).toBe(FIRST_DEFAULT);
    expect(pick.maxTokens).toBe(0);
  });

  test("total exhaustion is fatal", async () => {
    await expect(
      pickModel(
        parsePrefer("prefer=a\ncan=b"),
        { url: "http://h", label: "test" },
        probeFor(() => false),
        noCatalog,
      ),
    ).rejects.toThrow(/no model passed the probe/);
  });
});

// ── seed files: persona + template, with ask-time expansion ────────
test("setPersona/setTemplate stamp the chain ask() prepends, {{vars}} rendered at ask time", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    seen.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    setPersona("PERSONA-MARKER");
    setTemplate("TEND {{repo}} VIA {{model}} {{nope}}");
    const out = await ask(SimpleSchema, "instruction", "context", { ok: true });
    expect(out).toEqual({ ok: true });
    const content = String((seen[0]?.["messages"] as Array<{ content: string }>)[0]?.content);
    // persona then template, expansion rendered from live facts —
    // no pick stamped, so the model var renders the lane fallback
    expect(content.startsWith("PERSONA-MARKER\n\nTEND icomdev/calculon VIA lane-pinned {{nope}}\n\n")).toBe(true);
    expect(content).toContain("instruction");
    setPersona("");
    setTemplate("");
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ── hub label resolution (the azure shape: hub=ikea) ────────────
describe("pickHub", () => {
  test("a mapped label wins ahead of hub-url and the env buckle", async () => {
    // a LIVE hub the label maps to — Bun.serve on an ephemeral port,
    // hermetic (localhost only, no docker)
    const seen: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push(new URL(req.url).pathname);
        return Response.json({ data: [] });
      },
    });
    try {
      const p = parsePrefer("hub=ikea, ghost\nhub-url=http://dead.invalid:4111");
      const hub = await pickHub(p, { ikea: [server.url.toString()] });
      expect(hub).toEqual({ url: server.url.toString().replace(/\/$/, ""), label: "ikea" });
      expect(seen).toEqual(["/v1/models"]); // the mapped label answered
      expect(p.hubLabels).toEqual(["ikea", "ghost"]); // ghost had no map row → dropped
    } finally {
      server.stop(true);
    }
  });

  test("no answering hub degrades to the env buckle, labeled env", async () => {
    const p = parsePrefer("hub=ghost\nhub-url=http://dead.invalid:4111");
    const hub = await pickHub(p, {});
    expect(hub).toEqual({ url: "http://buckle3:4111", label: "env" }); // env.buckle in the unit world
  });
});

// ── catalog provider scoping (a buckle fronts several providers) ────
describe("fetchCatalog provider scope", () => {
  test("provider= keeps only that provider's rows; unscoped keeps all", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          data: [
            { id: "gpt-6.1-sol", origin: { kind: "provider", label: "mscopilot" } },
            { id: "glm-4.6", origin: { kind: "provider", label: "zai" } },
            { id: "legacy-untagged" },
          ],
        });
      },
    });
    try {
      const url = server.url.toString().replace(/\/$/, "");
      const scoped = await fetchCatalog(url, "mscopilot");
      expect([...scoped.keys()]).toEqual(["gpt-6.1-sol"]); // zai + untagged drop under the scope
      const unscoped = await fetchCatalog(url);
      expect([...unscoped.keys()].sort()).toEqual(["glm-4.6", "gpt-6.1-sol", "legacy-untagged"]);
    } finally {
      server.stop(true);
    }
  });

  test("the buckle's own {hub, models} projection parses — provenance rides along", async () => {
    // live wire shape from buckle3: {"hub":"b3","models":[{id,origin,meta},…]}
    // (no `data` key at all — the old schema parsed NONE of it)
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          hub: "ikea",
          models: [
            { id: "GPT-6.1-Sol", origin: { kind: "provider", label: "mscopilot", url: "https://api.githubcopilot.com" }, meta: { id: "GPT-6.1-Sol" } },
            { id: "glm-4.6", origin: { kind: "provider", label: "zai" }, meta: {} },
          ],
        });
      },
    });
    try {
      const url = server.url.toString().replace(/\/$/, "");
      const scoped = await fetchCatalog(url, "mscopilot");
      expect(scoped.get("gpt-6.1-sol")).toBe("GPT-6.1-Sol"); // casing law feeds from provenance rows
      const unscoped = await fetchCatalog(url);
      expect([...unscoped.keys()].sort()).toEqual(["glm-4.6", "gpt-6.1-sol"]);
    } finally {
      server.stop(true);
    }
  });
});
