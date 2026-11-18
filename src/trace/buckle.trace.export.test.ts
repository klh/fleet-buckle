import { expect, test } from "bun:test";
import { encodeOtlpSpan } from "./buckle.trace.export.ts";
const GOLDEN = "0a760a200a1e0a0c736572766963652e6e616d65120e0a0c666c6565742d6275636b6c6512520a0e0a0c666c6565742d6275636b6c6512400a100123456789abcdef0123456789abcdef12080123456789abcdef2a046368617430013940420f00000000004180841e00000000004a080a016b12030a0176";

test("encodes trace/span ids and name into OTLP protobuf", () => {
  const tid = "0123456789abcdef0123456789abcdef";
  const sid = "0123456789abcdef";
  const b = encodeOtlpSpan({ traceparent: `00-${tid}-${sid}-01`, name: "chat", startedAt: 1, endedAt: 2 });
  const hex = Buffer.from(b).toString("hex");
  expect(hex).toContain(`0a10${tid}`);
  expect(hex).toContain(`1208${sid}`);
  expect(hex).toContain(Buffer.from("chat").toString("hex"));
});

test("GOLDEN BYTES: known span -> exact OTLP protobuf (drift guard)", () => {
  const b = encodeOtlpSpan({
    traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    name: "chat",
    startedAt: 1,
    endedAt: 2,
    attributes: { k: "v" },
  });
  expect(Buffer.from(b).toString("hex")).toBe(GOLDEN);
});

test("lenient acceptance: kind is a hardcoded 1 (INTERNAL); receivers accept any enum, so the golden pins it", () => {
  const b = Buffer.from(
    encodeOtlpSpan({ traceparent: "00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01", name: "x", startedAt: 1, endedAt: 2 }),
  ).toString("hex");
  // field 6 varint = tag 0x30, value 01
  expect(b).toContain("3001");
});
