// worker.durable.ts — the DURABLE RUNTIME (the module worker.wake.ts
// and worker.main.ts headers promised): the sweep loop as a
// pi-durable task graph over a SQLite journal. Two task kinds share
// one mutex doc (repoagent.state, conversation-scoped):
//
//   repoagent.worker  (background, forever)  idle ─sleep(poll)→ gate → sweep ─┐
//   repoagent.kick    (one-shot, per wake)            gate → sweep → terminal│→ idle
//
// gate HOLDS (sleeps 250ms, re-checks) while another sweep runs: a
// wake DURING a sweep waits its turn, never interrupts — a replayed
// sweep would double-comment. The sweep body is worker.flow.ts
// VERBATIM; rows + mutex release bank in ONE commit, so a crash
// mid-sweep resumes the phase (at-least-once) and busySince lets a
// later gate steal a lock no sweep will ever release. The poll sleep
// is the reconciliation backstop the kicks race ahead of.
//
// THE FAULT BOUNDARY: this module owns the catch the old loop had in
// main.ts (deploy/ has no fault.ts reach — its build context is this
// directory); one failed sweep releases the mutex and retries at the
// next poll tick, never kills the graph.
import { z } from "zod";
import { createModels } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import {
  Harness,
  defineDoc,
  defineExtension,
  defineTask,
  ROOT_CONVERSATION_ID,
  createRegistry,
  type TaskRuntime,
  type Tx,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { env } from "./worker.env.ts";
import { sweep } from "./worker.flow.ts";
import { PhaseRow, type State } from "./worker.state.ts";

const GATE_HOLD_MS = 250;
/** a mutex older than this was left by a sweep that can never
 *  release it (task faulted terminal mid-sweep) — steal it */
const STALE_LOCK_MS = 10 * 60 * 1000;

// ── the shared doc: phase rows + the sweep mutex ──────────────────
const _RepoDocValue = z.object({
  rows: z.record(z.string(), PhaseRow),
  busy: z.boolean(),
  busySince: z.number(),
});
const RepoDoc = defineDoc({
  kind: "repoagent.state",
  version: 1,
  initial: (): z.output<typeof _RepoDocValue> => ({ rows: {}, busy: false, busySince: 0 }),
  scope: "conversation",
  history: "latest",
  fork: "initial",
  // rows bank once per sweep — a base per change is simplest and
  // the journal stays small (one row set, no delta chains to replay)
  checkpointWhen: () => true,
});

// ── task shapes (zod-derived; checkpoints are literal phase tags) ──
const _WorkerInputSchema = z.object({ boot: z.string() });
type WorkerInput = z.output<typeof _WorkerInputSchema>;

export const KickInputSchema = z.object({ requestId: z.string(), event: z.string() });
type KickInput = z.output<typeof KickInputSchema>;

type WorkerCheckpoint = { phase: "idle" } | { phase: "gate" } | { phase: "sweep" };
type KickCheckpoint = { phase: "gate" } | { phase: "sweep" };
type SweepRuntime<I, S, R> = TaskRuntime<I, S, R, object>;

const pollMs = (): number => env.pollSeconds * 1000;

/** the gate core: atomically (one commit) either take the mutex and
 *  move to sweep, or hold at the gate while another sweep runs. The
 *  returned states are members of both task kinds' NextTaskState. */
const gateState = async <I, S extends WorkerCheckpoint | KickCheckpoint, R>(
  tx: Tx,
  runtime: SweepRuntime<I, S, R>,
): Promise<
  | { status: "sleeping"; until: number; checkpoint: { phase: "gate" } }
  | { status: "running"; checkpoint: { phase: "sweep" } }
> => {
  const doc = await tx.doc(RepoDoc, runtime.conversationId);
  const stale = runtime.now() - doc.busySince > STALE_LOCK_MS;
  if (doc.busy && !stale)
    return {
      status: "sleeping",
      until: runtime.now() + GATE_HOLD_MS,
      checkpoint: { phase: "gate" },
    };
  doc.busy = true;
  doc.busySince = runtime.now();
  return { status: "running", checkpoint: { phase: "sweep" } };
};

/** the sweep body: load rows from the doc, run the flow VERBATIM,
 *  return the (possibly partially) mutated rows. This is THE fault
 *  boundary — one failed sweep returns ok:false with whatever rows
 *  earlier issues already banked (the old loop's semantics: partial
 *  progress survives a throw); the handler retries at the next poll. */
const runSweep = async <I, S extends WorkerCheckpoint | KickCheckpoint, R>(
  runtime: SweepRuntime<I, S, R>,
  context: Context,
): Promise<{ ok: boolean; rows: State["issues"]; error: string }> => {
  const doc = await runtime.snapshot(RepoDoc, runtime.conversationId, context);
  const state: State = { issues: doc?.rows ?? {} };
  try {
    await sweep(state);
  } catch (e) {
    return { ok: false, rows: state.issues, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, rows: state.issues, error: "" };
};

/** bank rows + release the mutex; the caller adds the task's own
 *  next state in the SAME commit by passing it through `next`. */
const releaseState = async <I, S extends WorkerCheckpoint | KickCheckpoint, R, N>(
  tx: Tx,
  runtime: SweepRuntime<I, S, R>,
  rows: State["issues"],
  next: N,
): Promise<N> => {
  const doc = await tx.doc(RepoDoc, runtime.conversationId);
  doc.rows = rows;
  doc.busy = false;
  return next;
};

// ── repoagent.worker — the forever poll task ──────────────────────
const WorkerTask = defineTask({
  name: "repoagent.worker",
  version: 1,
  initial: (_input: WorkerInput): WorkerCheckpoint => ({ phase: "idle" }),
  phases: {
    idle: async (_task, runtime, context) => {
      await runtime.sleepUntil(runtime.now() + pollMs(), { phase: "gate" }, context);
    },
    gate: async (_task, runtime, context) => {
      await runtime.commit((tx) => gateState(tx, runtime), context);
    },
    sweep: async (_task, runtime, context) => {
      const out = await runSweep(runtime, context);
      if (!out.ok) console.error(`[worker] sweep failed: ${out.error}`);
      await runtime.commit(
        (tx) =>
          releaseState(tx, runtime, out.rows, {
            status: "sleeping" as const,
            until: runtime.now() + pollMs(),
            checkpoint: { phase: "idle" as const },
          }),
        context,
      );
    },
  },
  abort: async (task, runtime, context) => {
    await runtime.commit(async (tx) => {
      const doc = await tx.doc(RepoDoc, runtime.conversationId);
      if (task.state.checkpoint.phase === "sweep") doc.busy = false;
      return {
        status: "terminal" as const,
        outcome: { status: "aborted" as const, reason: "shutdown" },
      };
    }, context);
  },
});

// ── repoagent.kick — the one-shot wake task ───────────────────────
const KickTask = defineTask({
  name: "repoagent.kick",
  version: 1,
  initial: (_input: KickInput): KickCheckpoint => ({ phase: "gate" }),
  phases: {
    gate: async (_task, runtime, context) => {
      await runtime.commit((tx) => gateState(tx, runtime), context);
    },
    sweep: async (_task, runtime, context) => {
      const out = await runSweep(runtime, context);
      if (!out.ok) {
        console.error(`[worker] kick sweep failed: ${out.error}`);
        await runtime.commit(
          (tx) =>
            releaseState(tx, runtime, out.rows, {
              status: "terminal" as const,
              outcome: { status: "failed" as const, error: { message: out.error } },
            }),
          context,
        );
        return;
      }
      await runtime.commit(
        (tx) =>
          releaseState(tx, runtime, out.rows, {
            status: "terminal" as const,
            outcome: { status: "completed" as const, result: { ok: true } },
          }),
        context,
      );
    },
  },
  abort: async (task, runtime, context) => {
    await runtime.commit(async (tx) => {
      const doc = await tx.doc(RepoDoc, runtime.conversationId);
      if (task.state.checkpoint.phase === "sweep") doc.busy = false;
      return {
        status: "terminal" as const,
        outcome: { status: "aborted" as const, reason: "shutdown" },
      };
    }, context);
  },
});

// ── the runtime face main.ts boots and wake.ts kicks ──────────────

const registry = createRegistry();
registry.install(defineExtension({ name: "repoagent", tasks: [WorkerTask, KickTask] }));

/** a live (non-terminal) repoagent.worker task exists in the journal */
const workerLive = async (tx: Tx): Promise<boolean> => {
  for (const status of ["pending", "running", "waiting", "sleeping"] as const) {
    const page = await tx.scanTasks({ kind: "repoagent.worker", status }, 1, undefined);
    if (page.items.length > 0) return true;
  }
  return false;
};

export type DurableRuntime = Awaited<ReturnType<typeof openRuntime>>;

/** open storage + harness, ensure the forever task exists, resume.
 *  Idempotent: a restarted container finds its mid-phase sweep in
 *  the journal and continues it. */
export const openRuntime = async () => {
  const storage = await openNodeSqliteStorage(env.storePath);
  const harness = await Harness.open(
    storage,
    {
      // pi-ai satisfies Harness's required models: shape ONLY — the
      // live worker's every model ask rides the buckle wire
      // (worker.model.ts ask()); this image carries no provider keys,
      // so nothing can egress around buckle, and a harness-side model
      // call would fail auth loudly, not bypass.
      models: createModels(),
      registry,
      onReport: (report) => console.error(`[worker] durable report: ${report.kind}`),
    },
    BACKGROUND_CONTEXT,
  );
  await harness.root(BACKGROUND_CONTEXT); // ensure the root conversation the tasks + doc call home
  await harness.commit(async (tx) => {
    if (!(await workerLive(tx)))
      await tx.createTask(
        WorkerTask,
        { boot: new Date().toISOString() },
        {
          ownership: { kind: "conversation" },
          conversationId: ROOT_CONVERSATION_ID,
          background: true,
        },
      );
  }, BACKGROUND_CONTEXT);
  harness.resume();
  return harness;
};

/** admit a verified wake as a durable kick task (at-least-once; the
 *  sweep itself is idempotent). `input` is already schema-parsed. */
export const kick = async (harness: DurableRuntime, input: KickInput): Promise<void> => {
  await harness.commit(async (tx) => {
    await tx.createTask(KickTask, input, {
      ownership: { kind: "conversation" },
      conversationId: ROOT_CONVERSATION_ID,
    });
  }, BACKGROUND_CONTEXT);
};
