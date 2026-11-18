// proxy/buckle.proxy.a2a.ts — B11: A2A gateway leg. The Worker owns the
// A2A face; this module pins the protocol, authorizes the caller, and
// persists the A2A task id -> {runner UUID, Pi submission id, writer
// epoch} mapping so duplicate delivery, restart and cancel all hit the
// same fenced runner. The LiteLLM kill-switch webhook is NOT cancellation.
import { z } from "zod";

export const A2A_PROTOCOL_VERSION = "0.3" as const;

const A2aBindingSchema = z.object({
  taskId: z.string(),
  runnerUuid: z.string(),
  piSubmissionId: z.string(),
  writerEpoch: z.number(),
  state: z.enum(["submitted", "working", "canceled", "completed", "failed"]),
});
export type A2aBinding = Readonly<z.output<typeof A2aBindingSchema>>;

const A2aRpcSchema = z.object({
  id: z.unknown().optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});
const A2aMessageSchema = z.object({ messageId: z.string().optional() }).passthrough();

/** durable store seam (Worker/DB backed in prod, Map in the fixture) */
const A2aBindingStoreSchema = z.object({
  get: z.custom<(key: string) => Promise<A2aBinding | undefined>>(),
  put: z.custom<(key: string, b: A2aBinding) => Promise<void>>(),
});
export type A2aBindingStore = z.output<typeof A2aBindingStoreSchema>;

/** the Worker host admission/cancel API */
const A2aWorkerSchema = z.object({
  admit: z.custom<(idempotencyKey: string, message: unknown) => Promise<Omit<A2aBinding, "state">>>(),
  cancel: z.custom<(b: A2aBinding) => Promise<"canceled" | "stale-epoch">>(),
  status: z.custom<(b: A2aBinding) => Promise<A2aBinding["state"]>>(),
});
export type A2aWorker = z.output<typeof A2aWorkerSchema>;

const A2aDepsSchema = z.object({
  store: A2aBindingStoreSchema,
  worker: A2aWorkerSchema,
  /** caller must hold the a2a scope */
  authorize: z.custom<(req: Request) => boolean>(),
  card: z.record(z.string(), z.unknown()),
});
export type A2aDeps = Readonly<z.output<typeof A2aDepsSchema>>;

const rpc = (id: unknown, result?: unknown, code?: number, message?: string): Response =>
  Response.json(
    code === undefined ? { jsonrpc: "2.0", id, result } : { jsonrpc: "2.0", id, error: { code, message } },
  );

export async function handleA2a(req: Request, d: A2aDeps): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/.well-known/agent-card.json"))
    return Response.json({ ...d.card, protocolVersion: A2A_PROTOCOL_VERSION });
  if (!d.authorize(req)) return new Response("forbidden", { status: 403 });
  const body = A2aRpcSchema.parse(await req.json());
  const p = body.params ?? {};
  switch (body.method) {
    case "message/send":
    case "message/stream": {
      const msg = A2aMessageSchema.optional().parse(p["message"]);
      if (msg?.messageId === undefined) return rpc(body.id, undefined, -32602, "messageId required");
      const key = `msg:${msg.messageId}`;
      let b = await d.store.get(key);
      if (b === undefined) {
        const a = await d.worker.admit(msg.messageId, msg);
        b = { ...a, state: "submitted" };
        await d.store.put(key, b);
        await d.store.put(`task:${b.taskId}`, b);
      }
      return rpc(body.id, { kind: "task", id: b.taskId, status: { state: b.state } });
    }
    case "tasks/get":
    case "tasks/resubscribe":
    case "tasks/cancel": {
      const b = await d.store.get(`task:${String(p["id"])}`);
      if (b === undefined) return rpc(body.id, undefined, -32001, "task not found");
      if (body.method === "tasks/cancel") {
        if ((await d.worker.cancel(b)) === "stale-epoch")
          return rpc(body.id, undefined, -32002, "writer epoch fenced");
        const n = { ...b, state: "canceled" as const };
        await d.store.put(`task:${b.taskId}`, n);
        return rpc(body.id, { kind: "task", id: b.taskId, status: { state: "canceled" } });
      }
      const state = await d.worker.status(b);
      return rpc(body.id, { kind: "task", id: b.taskId, status: { state } });
    }
    default:
      return rpc(body.id, undefined, -32601, "method not found");
  }
}
