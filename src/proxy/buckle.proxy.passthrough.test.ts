// egress audit: engine-bound pass-through requests carry no internal ids.
// NOTE: the chat leg (engine.ts) deliberately continues traceparent to
// OUR litellm and stamps x-litellm-tags (lane/principal) — operator-owned
// engine only; the verbatim pass-through relay strips all of these.
import { expect, test } from "bun:test";
import { relayHeaders } from "./buckle.proxy.passthrough.ts";

test("pass-through relay strips traceparent and internal ids", () => {
  const req = new Request("http://x/v1/models", {
    headers: {
      traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
      tracestate: "a=b",
      baggage: "k=v",
      "x-fleet-buckle-hop-path": "a,b",
      "x-buckle-route": "r",
      "x-runner-id": "r1",
      "x-epoch": "3",
      "x-conversation-id": "c",
      "x-submission-id": "s",
      "x-request-id": "q",
      authorization: "Bearer caller",
      accept: "application/json",
    },
  });
  expect(relayHeaders(req)).toEqual({ accept: "application/json" });
});
