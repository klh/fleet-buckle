import { expect, test } from "bun:test";
import { encodeOtlpSpan } from "./buckle.trace.export.ts";

test("encodes trace/span ids and name into OTLP protobuf", () => {
  const tid = "0123456789abcdef0123456789abcdef";
  const sid = "0123456789abcdef";
  const b = encodeOtlpSpan({ traceparent: `00-${tid}-${sid}-01`, name: "chat", startedAt: 1, endedAt: 2 });
  const hex = Buffer.from(b).toString("hex");
  expect(hex).toContain(`0a10${tid}`);
  expect(hex).toContain(`1208${sid}`);
  expect(hex).toContain(Buffer.from("chat").toString("hex"));
});
