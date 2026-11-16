// worker.main.ts — the ENTRY: boot guard + the durable runtime + the
// wake face. The compartments live beside this file (env / github /
// state / model / exec / wake / flow / durable) — this file owns ONLY
// process lifecycle. The loop this file used to run is now a
// pi-durable task graph (worker.durable.ts): idle sleeps are durable
// sleeps, sweeps resume mid-phase after a crash, and the process
// stays alive on the harness's own timers (plus the wake server).
import { existsSync, readFileSync } from "node:fs";
import { env } from "./worker.env.ts";
import { openRuntime } from "./worker.durable.ts";
import { serveWake } from "./worker.wake.ts";
import { fetchCatalog, probeModel } from "./worker.probe.ts";
import { parsePrefer, pickHub, pickModel, HubsSchema, type Hubs } from "./worker.prefer.ts";
import { setPersona, setPick, setTemplate } from "./worker.model.ts";

if (env.token === "" || env.buckleKey === "")
  throw new Error("WORKER_TOKEN and BUCKLE_KEY are required");

// the .prefer startup file (owner ruling 2026-11-16): absent = picker
// off (lane topology as before). BYOC lanes pin via URL token, so the
// picker is engine-mode only for now. must= exhaustion throws — the
// worker refuses to guess past an explicit pin.
if (!env.byoc && existsSync(env.preferFile)) {
  const p = parsePrefer(readFileSync(env.preferFile, "utf8"));
  // hub labels resolve through the seed dir's hubs.json (schema
  // law: safeParse, drift degrades to NO map — labels drop, hub-url
  // and the env buckle still resolve)
  const hubsRaw = await new Promise<unknown>((resolve) => {
    resolve(JSON.parse(readFileSync(env.hubsFile, "utf8")));
  }).catch((_e: unknown) => null);
  const parsedHubs = HubsSchema.safeParse(hubsRaw);
  const hubs: Hubs = parsedHubs.success ? parsedHubs.data : {};
  const hub = await pickHub(p, hubs);
  const catalog = await fetchCatalog(hub.url, p.provider);
  const chosen = await pickModel(p, hub, probeModel, catalog);
  setPick(chosen);
  console.log(
    `[worker] prefer: hub=${hub.url} (${hub.label}) provider=${chosen.provider || "-"} model=${chosen.model} tier=${chosen.tier} tag=${p.tag || "-"} color=${p.color || "-"} max_tokens=${p.maxTokens || "unlimited"} max_loops=${p.maxLoops || "unlimited"}`,
  );
}

// the seed dir persona chain: persona.md (character, rarely changes)
// + template.md (the INCOMING brief — the pi-durable template a new
// worker is created from). Both bake into the image at /etc/worker;
// a mount over that path overwrites either. A missing file is
// simply empty — a shadow-mount may provide only one.
if (existsSync(env.personaFile)) setPersona(readFileSync(env.personaFile, "utf8"));
if (existsSync(env.templateFile)) setTemplate(readFileSync(env.templateFile, "utf8"));

const harness = await openRuntime();
serveWake(harness);

console.log(
  `[worker] repo=${env.repo} lane=${env.lane} buckle=${env.buckle} poll=${env.pollSeconds}s wake=${env.wakeAddr || "off"} store=${env.storePath}`,
);
