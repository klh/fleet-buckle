// worker.main.ts — the ENTRY: boot guard + the durable runtime + the
// wake face. The compartments live beside this file (env / github /
// state / model / exec / wake / flow / durable) — this file owns ONLY
// process lifecycle. The loop this file used to run is now a
// pi-durable task graph (worker.durable.ts): idle sleeps are durable
// sleeps, sweeps resume mid-phase after a crash, and the process
// stays alive on the harness's own timers (plus the wake server).
import { env } from "./worker.env.ts";
import { openRuntime } from "./worker.durable.ts";
import { serveWake } from "./worker.wake.ts";

if (env.token === "" || env.buckleKey === "")
  throw new Error("WORKER_TOKEN and BUCKLE_KEY are required");

const harness = await openRuntime();
serveWake(harness);

console.log(
  `[worker] repo=${env.repo} lane=${env.lane} buckle=${env.buckle} poll=${env.pollSeconds}s wake=${env.wakeAddr || "off"} store=${env.storePath}`,
);
