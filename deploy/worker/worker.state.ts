// worker.state.ts — the phase-row SCHEMAS (the machine's durable
// vocabulary). The JSON-file storage this module used to own is
// gone: the rows live in pi-durable's repoagent.state doc (see
// worker.durable.ts) and ride its SQLite journal. flow stays the
// only writer; nothing here touches a filesystem.
import { z } from "zod";

export const PhaseRow = z.object({
  phase: z.enum(["seen", "clarified", "accepted", "delivered"]),
  lastComment: z.number(),
});
export type PhaseRow = z.output<typeof PhaseRow>;

export const State = z.object({
  issues: z.record(z.string(), PhaseRow),
});
export type State = z.infer<typeof State>;
