import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { A2A_PROTOCOL_VERSION, handleA2a, type A2aBinding, type A2aDeps } from "./buckle.proxy.a2a.ts";

function world() {
  const m = new Map<string, A2aBinding>();
  const log = { admits: 0, cancels: [] as number[] };
  let epoch = 7;
  const deps: A2aDeps = {
    store: { get: async (k) => m.get(k), put: async (k, b) => void m.set(k, b) },
    worker: {
      admit: async () => (log.admits++, { taskId: "t1", runnerUuid: "r-uuid", piSubmissionId: "s1", writerEpoch: epoch }),
      cancel: async (b) => (log.cancels.push(b.writerEpoch), b.writerEpoch === epoch ? "canceled" : "stale-epoch"),
      status: async (b) => b.state,
    },
    authorize: (r) => r.headers.get("authorization") === "Bearer ok",
    card: { name: "fleet-runner" },
  };
  return { m, log, deps, bump: () => void epoch++ };
}
const CallReply = z.object({
  result: z.object({ id: z.string(), status: z.object({ state: z.string() }) }).optional(),
  error: z.object({ code: z.number() }).optional(),
});
const call = (d: A2aDeps, method: string, params: unknown, auth = "Bearer ok") =>
  handleA2a(
    new Request("http://x/a2a/r", { method: "POST", headers: { authorization: auth }, body: JSON.stringify({ id: 1, method, params }) }),
    d,
  ).then(async (r) => CallReply.parse(await r.json()));

describe("B11 A2A gateway", () => {
  test("card pins protocol", async () => {
    const { deps } = world();
    const r = await handleA2a(new Request("http://x/a2a/r/.well-known/agent-card.json"), deps);
    expect(z.object({ protocolVersion: z.string() }).parse(await r.json()).protocolVersion).toBe(A2A_PROTOCOL_VERSION);
  });
  test("auth rejected", async () => {
    const { deps } = world();
    const r = await handleA2a(new Request("http://x/a2a/r", { method: "POST", body: "{}" }), deps);
    expect(r.status).toBe(403);
  });
  test("duplicate delivery admits once; restart keeps mapping; cancel hits same fenced runner", async () => {
    const w = world();
    const a = await call(w.deps, "message/send", { message: { messageId: "m1" } });
    const b = await call(w.deps, "message/send", { message: { messageId: "m1" } });
    expect(a.result?.id).toBe(b.result?.id);
    expect(w.log.admits).toBe(1);
    // restart: fresh handler deps over the same durable store
    const again = { ...w.deps };
    expect((await call(again, "tasks/get", { id: "t1" })).result?.status.state).toBe("submitted");
    expect((await call(again, "tasks/cancel", { id: "t1" })).result?.status.state).toBe("canceled");
    expect(w.m.get("task:t1")?.state).toBe("canceled");
    expect(w.m.get("task:t1")).toMatchObject({ runnerUuid: "r-uuid", piSubmissionId: "s1", writerEpoch: 7 });
  });
  test("stale epoch cancel is fenced", async () => {
    const w = world();
    await call(w.deps, "message/send", { message: { messageId: "m2" } });
    w.bump();
    expect((await call(w.deps, "tasks/cancel", { id: "t1" })).error?.code).toBe(-32002);
  });
  test("duplicate after cancel stays canceled; stream/resubscribe/unknown", async () => {
    const w = world();
    await call(w.deps, "message/stream", { message: { messageId: "m3" } });
    await call(w.deps, "tasks/cancel", { id: "t1" });
    expect((await call(w.deps, "message/send", { message: { messageId: "m3" } })).result?.status.state).toBe("canceled");
    expect((await call(w.deps, "tasks/resubscribe", { id: "t1" })).result?.status.state).toBe("canceled");
    expect((await call(w.deps, "tasks/get", { id: "nope" })).error?.code).toBe(-32001);
    expect(w.log.admits).toBe(1);
  });
});
