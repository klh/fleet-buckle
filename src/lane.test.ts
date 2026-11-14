// lane.test.ts — the lane-prefix parser: the W1 attribution contract
import { describe, expect, test } from "bun:test";
import { lanePrefixOf } from "./lane.ts";

describe("lanePrefixOf", () => {
  test("strips /w/<slug> and returns the bare remainder", () => {
    expect(lanePrefixOf("/w/pi-1/v1/chat/completions")).toEqual({
      lane: "pi-1",
      path: "/v1/chat/completions",
    });
    expect(lanePrefixOf("/w/codex.2_w/v1/messages")).toEqual({
      lane: "codex.2_w",
      path: "/v1/messages",
    });
    expect(lanePrefixOf("/w/solo")).toEqual({ lane: "solo", path: "/" });
  });

  test("a bare path rides unchanged, lane empty", () => {
    expect(lanePrefixOf("/v1/chat/completions")).toEqual({
      lane: "",
      path: "/v1/chat/completions",
    });
    expect(lanePrefixOf("/healthz")).toEqual({ lane: "", path: "/healthz" });
  });

  test("a malformed slug is NOT a lane prefix (rides verbatim)", () => {
    expect(lanePrefixOf("/w/-bad/v1/messages")).toEqual({
      lane: "",
      path: "/w/-bad/v1/messages",
    });
    expect(lanePrefixOf("/workflow/x")).toEqual({
      lane: "",
      path: "/workflow/x",
    });
  });
});
