// e2e — PROJECT 2 (depends on smoke): the grants matrix through the
// real Docker stack. Catalog VIEWS are per principal (grant.peers:
// absent = every configured peer; [] = own rows only). Denial paths
// are problem+json: 401 unknown principal/key on THIS buckle, 403
// known principal without the scope.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const KEY = (p: string) =>
  readFileSync(join(ROOT, `deploy/keys/.gen/${p}`), "utf8").trim();
const alice = KEY("principal.alice@fleet.key");
const bob = KEY("principal.bob@fleet.key");
const carol = KEY("principal.carol@fleet.key");

const B1 = "http://127.0.0.1:4711";
const B2 = "http://127.0.0.1:4721";
const B3 = "http://127.0.0.1:4731";

async function view(base: string, token: string): Promise<Response> {
  return fetch(`${base}/v1/models`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function ids(base: string, token: string): Promise<string[]> {
  const r = await view(base, token);
  expect(r.status).toBe(200);
  const body = (await r.json()) as { models: { id: string }[] };
  return body.models.map((m) => m.id).sort();
}

test.describe("the federation matrix (Docker)", () => {
  // a key valid HERE sees the view the REGISTRY grants — per cell:
  test("alice@b1: own provider rows ONLY (empty peer list)", async () => {
    expect(await ids(B1, alice)).toEqual([
      "openai/qwen3-235b",
      "openai/qwen3-coder",
    ]);
  });

  test("bob@b1: own + b3's zai rows", async () => {
    expect(await ids(B1, bob)).toEqual([
      "openai/glm-5.3",
      "openai/glm-5.3-air",
      "openai/qwen3-235b",
      "openai/qwen3-coder",
    ]);
  });

  test("carol@b1: every peer rides (openrouter + copilot + zai)", async () => {
    expect(await ids(B1, carol)).toEqual([
      "openai/glm-5.3",
      "openai/glm-5.3-air",
      "openai/gpt-6-astra",
      "openai/qwen3-235b",
      "openai/qwen3-coder",
    ]);
  });

  test("carol@b2: copilot + b3's zai", async () => {
    expect(await ids(B2, carol)).toEqual([
      "openai/glm-5.3",
      "openai/glm-5.3-air",
      "openai/gpt-6-astra",
    ]);
  });

  test("carol@b3: zai only (leaf buckle — nothing downstream)", async () => {
    expect(await ids(B3, carol)).toEqual([
      "openai/glm-5.3",
      "openai/glm-5.3-air",
    ]);
  });

  test("denial paths — 401 unknown principal on THIS buckle", async () => {
    // bob's key exists in the shared dir, but b2's registry doesn't know him
    const r = await view(B2, bob);
    expect(r.status).toBe(401);
    expect(r.headers.get("content-type")).toContain("application/problem+json");
    expect(((await r.json()) as { title: string }).title).toBeTruthy();
  });

  test("denial paths — 403 known principal without the scope", async () => {
    // bob IS a principal on b3, but holds no tree.read there
    const r = await fetch(`${B3}/v1/tree`, {
      headers: { authorization: `Bearer ${bob}` },
    });
    expect(r.status).toBe(403);
    expect(r.headers.get("content-type")).toContain("application/problem+json");
  });

  test("no key anywhere: 401 (fail closed)", async () => {
    expect((await fetch(`${B1}/v1/models`)).status).toBe(401);
    expect((await fetch(`${B2}/v1/chat/completions`, { method: "POST" })).status).toBe(401);
  });
});
