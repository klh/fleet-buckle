import { z } from "zod";

/** The ONE fault seam of this package (mirrors the repo law: classify,
 *  never swallow; try/catch lives HERE, not at call sites). */
export const FaultSchema = z.object({
  kind: z.enum([
    "config-unreadable",
    "config-parse",
    "pat-unreadable",
    "secrets-mode",
    "entra-failed",
    "preflight-failed",
    "cli-failed",
  ]),
  detail: z.string(),
});
export type Fault = z.output<typeof FaultSchema>;

export const fault = (kind: Fault["kind"], detail: string): Fault => ({ kind, detail });

export const attempt = <T>(run: () => T, failed: (f: Fault) => T): T => {
  try {
    return run();
  } catch (e) {
    return failed(fault("config-unreadable", e instanceof Error ? e.message : String(e)));
  }
};
