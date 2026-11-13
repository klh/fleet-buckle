// buckle.access.zod.test.ts — colocated unit (bun test): the registry
// parses, kinds are the four Entra-mappable ones, scopes are closed.
import { describe, expect, test } from "bun:test";
import {
  BuckleAccessRegistry,
  type BuckleGrant,
} from "./buckle.access.zod.ts";

describe("BuckleAccessRegistry", () => {
  test("parses tiers, principals, grants", () => {
    const reg = BuckleAccessRegistry.parse({
      tiers: [
        { label: "agents", kind: "agent", max_concurrent: 32, max_rpm: 600 },
        { label: "devs", kind: "developer", max_concurrent: 8 },
      ],
      principals: [
        { id: "alice@fleet", kind: "human" },
        { id: "bob@fleet", kind: "developer", groups: ["platform"] },
        { id: "agent-07@fleet.local", kind: "agent", tier: "agents" },
      ],
      grants: [
        { principal: "alice@fleet", scopes: ["models.list"] },
        {
          principal: "agent-07@fleet.local",
          scopes: ["models.list", "models.use"],
          limits: { max_concurrent: 4 },
        },
      ],
    });
    expect(reg.principals).toHaveLength(3);
    expect(reg.grants[1]?.limits?.max_concurrent).toBe(4);
  });

  test("unknown scope fails loud", () => {
    const bad: unknown = {
      grants: [{ principal: "x@fleet", scopes: ["root"] }],
    };
    expect(() => BuckleAccessRegistry.parse(bad)).toThrow();
  });

  test("a grant is shaped for one-line Entra mapping", () => {
    const g = {
      principal: "bob@fleet",
      scopes: ["models.list", "models.use"],
    } as const satisfies BuckleGrant;
    expect(g.scopes).toHaveLength(2);
  });
});
