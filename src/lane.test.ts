// lane.test.ts — the lane-prefix parser: the W1 attribution contract
// + the /w/<slug>/<token> BYOC extension (routing and the caller's
// own upstream credential in the one URL)
import { describe, expect, test } from "bun:test";
import { lanePrefixOf, userIdOf } from "./lane.ts";

const PAT = "ghp_" + "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

describe("lanePrefixOf", () => {
  test("strips /w/<slug> and returns the bare remainder", () => {
    expect(lanePrefixOf("/w/pi-1/v1/chat/completions")).toEqual({
      lane: "pi-1",
      path: "/v1/chat/completions",
      userToken: null,
    });
    expect(lanePrefixOf("/w/codex.2_w/v1/messages")).toEqual({
      lane: "codex.2_w",
      path: "/v1/messages",
      userToken: null,
    });
    expect(lanePrefixOf("/w/solo")).toEqual({ lane: "solo", path: "/", userToken: null });
  });

  test("a bare path rides unchanged, lane empty", () => {
    expect(lanePrefixOf("/v1/chat/completions")).toEqual({
      lane: "",
      path: "/v1/chat/completions",
      userToken: null,
    });
    expect(lanePrefixOf("/healthz")).toEqual({ lane: "", path: "/healthz", userToken: null });
  });

  test("a malformed slug is NOT a lane prefix (rides verbatim)", () => {
    expect(lanePrefixOf("/w/-bad/v1/messages")).toEqual({
      lane: "",
      path: "/w/-bad/v1/messages",
      userToken: null,
    });
    expect(lanePrefixOf("/workflow/x")).toEqual({
      lane: "",
      path: "/workflow/x",
      userToken: null,
    });
  });

  test("a long second segment is the BYOC token (stripped, returned)", () => {
    expect(lanePrefixOf(`/w/copilot/${PAT}/v1/chat/completions`)).toEqual({
      lane: "copilot",
      path: "/v1/chat/completions",
      userToken: PAT,
    });
    // the token at the tail (client base_url pointing at the root)
    expect(lanePrefixOf(`/w/copilot/${PAT}`)).toEqual({
      lane: "copilot",
      path: "/",
      userToken: PAT,
    });
    // dot-carrying credentials (Entra JWTs) parse too
    expect(lanePrefixOf("/w/entra/eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJvaWQiOiJh/v1/messages")).toEqual({
      lane: "entra",
      path: "/v1/messages",
      userToken: "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJvaWQiOiJh",
    });
  });

  test("a SHORT second segment is a plain path word, never a token", () => {
    expect(lanePrefixOf("/w/copilot/v1/chat/completions")).toEqual({
      lane: "copilot",
      path: "/v1/chat/completions",
      userToken: null,
    });
    expect(lanePrefixOf("/w/agents/models")).toEqual({
      lane: "agents",
      path: "/models",
      userToken: null,
    });
  });
});

describe("userIdOf", () => {
  test("stable per token, distinct across tokens, never the token itself", () => {
    const a = userIdOf(PAT);
    expect(a).toMatch(/^user:[0-9a-f]{8}$/);
    expect(userIdOf(PAT)).toBe(a); // stable
    expect(userIdOf(PAT.replace("a", "b"))).not.toBe(a); // distinct
    expect(a.includes(PAT.slice(0, 8))).toBe(false); // no token bytes
  });
});
