// worker.main.ts — the ENTRY: boot guard, wake face, the loop. The
// compartments live beside this file (env / github / state / model /
// exec / wake / flow) — this file owns ONLY process lifecycle. The
// durable rework replaces this loop (and worker.wake.ts) with a
// pi-durable runtime; every other compartment survives verbatim.
import { env } from "./worker.env.ts";
import { loadState, saveState } from "./worker.state.ts";
import { sweep } from "./worker.flow.ts";
import { serveWake, sleepOrWake } from "./worker.wake.ts";

if (env.token === "" || env.buckleKey === "")
  throw new Error("WORKER_TOKEN and BUCKLE_KEY are required");

serveWake();

console.log(
  `[worker] repo=${env.repo} lane=${env.lane} buckle=${env.buckle} poll=${env.pollSeconds}s wake=${env.wakeAddr || "off"}`,
);
for (;;) {
  // the fault boundary is the sweep: one bad sweep never kills the
  // loop, and state mutations from earlier issues bank before a
  // throw (saveState runs after the catch). Compose restart = the
  // crash backstop; durability is the container's job until the
  // durable rework.
  const state = loadState();
  try {
    await sweep(state);
  } catch (e) {
    console.error(`[worker] sweep failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  saveState(state);
  await sleepOrWake();
}
