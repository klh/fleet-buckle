import { describe, expect, test } from "bun:test";
import { wireRefusal } from "./buckle.route.zod.ts";

const tools = [{ type: "function", function: { name: "t" } }];
describe("wireRefusal (drop_params qualification)", () => {
  test("tool/SSE-shaped request admitted", () => {
    expect(wireRefusal({ model: "m", stream: true, tools, tool_choice: "auto" }, { tool_calls: true })).toBeNull();
  });
  test("unknown support admitted; explicit false refused", () => {
    expect(wireRefusal({ tools }, undefined)).toBeNull();
    expect(wireRefusal({ tools }, { tool_calls: false })).toContain("dropped");
  });
  test("mcp_servers refused, never left to drop_params", () => {
    expect(wireRefusal({ mcp_servers: [{}] }, undefined)).toContain("mcp_servers");
  });
  test("no tools with tool_calls:false is fine", () => {
    expect(wireRefusal({ messages: [] }, { tool_calls: false })).toBeNull();
  });
});
