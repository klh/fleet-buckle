// context/buckle.context.judge.ts — the CONTEXT-INJECTION decision
// seam: at ingress (originating requests only — hop arrivals already
// had their chance), the pipeline asks ONE judge callback "does this
// call need context injected?" with everything needed to decide
// (who is asking, what they asked — the body's start — which model,
// which route). TRUE = no injection needed (THE DEFAULT — the body
// rides byte-identical, the chain continues); {system} = a system
// stanza is prepended (the ONE sanctioned body mutation, named in
// the pipeline). The judge runs ON the request path: sync, O(1)
// policy — never IO (same non-blocking contract as the bus).
import { readFileSync } from "node:fs";
import { z } from "zod";
import { BucklePrincipalKind } from "../schemas/buckle.principal.zod.ts";
import type {
  BuckleContextPolicy,
  BuckleContextRule,
  BuckleSettings,
} from "../schemas/buckle.settings.zod.ts";

/** the facts a judge decides on — server-side truth + the body's
 *  START (first chars: what was asked, from whom) */
export const ContextFacts = z
  .object({
    route: z.literal("chat"),
    principal: z.string().min(1),
    principalKind: BucklePrincipalKind.optional(),
    model: z.string().min(1),
    /** the body's first bytes — the judging window (never the whole
     *  body; bounded by the pipeline's slice) */
    bodyStart: z.string(),
    /** the fleet CLI hook's stamp (x-fleet-repo) — absent for
     *  non-fleet clients; repo-matching rules cannot fire on it */
    repo: z.string().min(1).optional(),
  })
  .strict();
export type ContextFacts = z.output<typeof ContextFacts>;

/** the verdict: TRUE = continue verbatim (default); {system} = the
 *  stanza to prepend as the first system message */
export type ContextInjection = true | { system: string };

/** the seam: any sync predicate can ride (bootServer accepts one);
 *  the shipped default is built from settings (below) */
export type ContextJudge = (facts: ContextFacts) => ContextInjection;

/** THE default — inert: nothing is ever injected unless a policy
 *  says so (zero bytes touched, zero cost) */
export const inertJudge: ContextJudge = () => true;

/** the rule's stanza: text inline, or the file read ONCE at boot
 *  (fail loud on unreadable — custody stays at boot, never on-path;
 *  the parked design's repo_file rule rides this same hole) */
function stanzaOf(rule: BuckleContextRule): string {
  return "text" in rule ? rule.text : readFileSync(rule.file, "utf8");
}

/** EVERY declared dimension must match (AND semantics); a rule with
 *  no dimensions matches everything */
function ruleMatches(rule: BuckleContextRule, facts: ContextFacts): boolean {
  if (rule.principal !== undefined && rule.principal !== facts.principal) return false;
  if (rule.models !== undefined && !rule.models.some((m) => facts.model.startsWith(m)))
    return false;
  if (rule.bodyContains !== undefined && !facts.bodyStart.includes(rule.bodyContains))
    return false;
  return true;
}

/** the shipped judge: FIRST matching rule's stanza wins (stanzas
 *  resolved at BUILD — the path is O(1) compares); no policy or no
 *  match = inert (the default verdict, the chain continues) */
export function judgeOf(policy: BuckleContextPolicy | undefined): ContextJudge {
  if (policy === undefined) return inertJudge;
  const rules = policy.inject.map((rule) => ({ rule, stanza: stanzaOf(rule) }));
  return (facts: ContextFacts): ContextInjection => {
    for (const { rule, stanza } of rules)
      if (ruleMatches(rule, facts)) return { system: stanza };
    return true;
  };
}

/** compose from the settings block (the config-over-code face of
 *  the same seam) */
export function judgeFromSettings(settings: BuckleSettings): ContextJudge {
  return judgeOf(settings.context_policy);
}
