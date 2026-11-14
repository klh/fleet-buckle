// worker.state.ts — the durable state compartment: a JSON file on a
// volume, torn/missing reads fall back to the last good state
// (front.main.ts idiom). THIS is the module the durable rework
// REPLACES first: the phase rows move onto pi-durable's storage and
// the sweep becomes a durable task — the schema itself survives.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
import { env } from "./worker.env.ts";

export const PhaseRow = z.object({
  phase: z.enum(["seen", "clarified", "accepted", "delivered"]),
  lastComment: z.number(),
});
export type PhaseRow = z.output<typeof PhaseRow>;

export const State = z.object({
  issues: z.record(z.string(), PhaseRow),
});
export type State = z.infer<typeof State>;

export function loadState(): State {
  try {
    const raw = readFileSync(env.statePath, "utf8");
    const parsed = State.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through to empty
  }
  return { issues: {} };
}

export function saveState(s: State): void {
  mkdirSync(env.statePath.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(env.statePath, JSON.stringify(s, null, 2));
}
