// proxy/buckle.proxy.a2a.ts — B11: A2A gateway leg. The Worker owns the
// A2A face; this module pins the protocol, authorizes the caller, and
// persists the A2A task id -> {runner UUID, Pi submission id, writer
// epoch} mapping so duplicate delivery, restart and cancel all hit the
// same fenced runner. The LiteLLM kill-switch webhook is NOT cancellation.
export const A2A_PROTOCOL_VERSION = "0.3" as const;

export interface A2aBinding {
  readonly taskId: string;
  readonly runnerUuid: string;
  readonly piSubmissionId: string;
  readonly writerEpoch: number;
  readonly state: "submitted" | "working" | "canceled" | "completed" | "failed";
}

/** durable store seam (Worker/DB backed in prod, Map in the fixture) */
export interface A2aBindingStore {
  get(key: string): Promise<A2aBinding | undefined>;
  put(key: string, b: A2aBinding): Promise<void>;
}

/** the Worker host admission/cancel API */
export interface A2aWorker {
  admit(idempotencyKey: string, message: unknown): Promise<Omit<A2aBinding, "state">>;
  cancel(b: A2aBinding): Promise<"canceled" | "stale-epoch">;
  status(b: A2aBinding): Promise<A2aBinding["state"]>;
}

export interface A2aDeps {
  readonly store: A2aBindingStore;
  readonly worker: A2aWorker;
  /** caller must hold the a2a scope */
  readonly authorize: (req: Request) => boolean;
  readonly card: Record<string, unknown>;
}

const rpc = (id: unknown, result?: unknown, code?: number, message?: string): Response =>
  Response.json(
    code === undefined ? { jsonrpc: "2.0", id, result } : { jsonrpc: "2.0", id, error: { code, message } },
  );

export async function handleA2a(req: Request, d: A2aDeps): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/.well-known/agent-card.json"))
    return Response.json({ ...d.card, protocolVersion: A2A_PROTOCOL_VERSION });
  if (!d.authorize(req)) return new Response("forbidden", { status: 403 });
  const body = (await req.json()) as { id?: unknown; method?: string; params?: Record<string, unknown> };
  const p = body.params ?? {};
  switch (body.method) {
    case "message/send":
    case "message/stream": {
      const msg = p["message"] as { messageId?: string } | undefined;
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
