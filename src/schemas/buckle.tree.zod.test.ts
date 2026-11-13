// buckle.tree.zod.test.ts — colocated unit (bun test): the recursive node
// parses the demo tree (b1 → b2 → b3), peers nest, origins discriminate.
import { describe, expect, test } from "bun:test";
import { BuckleTreeResponse } from "./buckle.tree.zod.ts";
import demoTree from "./fixtures/tree.demo.json";

describe("BuckleTreeResponse", () => {
  test("parses the demo topology: self b1, peers b2(b3), b3", () => {
    const tree = BuckleTreeResponse.parse(demoTree);
    expect(tree.self.buckle.label).toBe("b1");
    expect(tree.self.models[0]?.origin.kind).toBe("provider");
    const peerLabels = tree.self.peers.map((p) => p.buckle.label).sort();
    expect(peerLabels).toEqual(["b2", "b3"]);
    // b2's own downstream b3 shows through it — chains compose
    const b2 = tree.self.peers.find((p) => p.buckle.label === "b2");
    expect(b2?.peers.map((p) => p.buckle.label)).toEqual(["b3"]);
  });

  test("provider meta rides verbatim (ms copilot shape)", () => {
    const tree = BuckleTreeResponse.parse(demoTree);
    const b2 = tree.self.peers.find((p) => p.buckle.label === "b2");
    const meta = b2?.models[0]?.meta as Record<string, unknown>;
    expect(meta.name).toBe("GPT-6 Astra");
    expect(meta.model_picker_enabled).toBe(true);
  });
});
