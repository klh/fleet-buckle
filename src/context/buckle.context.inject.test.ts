// buckle.context.inject.test.ts — the responses dialect's injection
// contract: the stanza rides the TOP-LEVEL instructions (absent →
// stanza, string → merged, foreign shape → untouched), the lane pin
// rewrites the model, and the engine path map names the wire leg for
// every dialect.
import { describe, expect, test } from "bun:test";
import { ENGINE_PATH, injectedBodyOf, pinnedBodyOf } from "./buckle.context.inject.ts";

/** the wire ask (the OpenAI Responses shape: model + instructions
 *  + input) */
const RESPONSES_BODY = JSON.stringify({
  model: "openrouter/qwen3-coder",
  instructions: "KEEP-ME",
  input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
});

describe("ENGINE_PATH (the engine wire leg per dialect)", () => {
  test("each dialect names its engine face — responses rides /v1/responses", () => {
    expect(ENGINE_PATH).toEqual({
      chat: "/v1/chat/completions",
      messages: "/v1/messages",
      responses: "/v1/responses",
    });
  });
});

describe("injectedBodyOf (responses dialect)", () => {
  test("absent instructions — the stanza becomes the instructions", () => {
    const out = JSON.parse(
      injectedBodyOf(JSON.stringify({ model: "m", input: "hi" }), "STANZA", "responses"),
    );
    expect(out.instructions).toBe("STANZA");
    expect(out.input).toBe("hi"); // the rest of the body survives
  });

  test("string instructions — the stanza PREPENDS, never replaces", () => {
    const out = JSON.parse(injectedBodyOf(RESPONSES_BODY, "STANZA", "responses"));
    expect(out.instructions).toBe("STANZA\n\nKEEP-ME");
    expect(out.model).toBe("openrouter/qwen3-coder");
    expect(out.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "hi" }] }]);
  });

  test("a foreign instructions shape rides UNTOUCHED (never corrupted)", () => {
    const odd = JSON.stringify({
      model: "m",
      instructions: [{ type: "instructions", text: "x" }],
      input: [],
    });
    expect(injectedBodyOf(odd, "STANZA", "responses")).toBe(odd);
  });

  test("malformed JSON rides untouched", () => {
    expect(injectedBodyOf("not json", "STANZA", "responses")).toBe("not json");
  });
});

describe("pinnedBodyOf (the lane pin crosses dialects)", () => {
  test("a /w/<slug> pin rewrites the model on a responses body", () => {
    const out = JSON.parse(pinnedBodyOf(RESPONSES_BODY, "openrouter/pinned"));
    expect(out.model).toBe("openrouter/pinned");
    expect(out.instructions).toBe("KEEP-ME");
  });
});
