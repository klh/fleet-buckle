// context/buckle.context.judge.ts — the CONTEXT-INJECTION decision
// seam: at ingress (originating requests only — hop arrivals already
// had their chance), the pipeline asks ONE judge callback "does this
// call need context injected?" with everything needed to decide
// (who is asking and their groups, what they asked — the body's
// start — which model, which repo/lane/work the fleet hook
// stamped). TRUE = no injection needed (THE DEFAULT — the body
// rides byte-identical, the chain continues); {system, rule} = a
// system stanza rides (the ONE sanctioned body mutation, named in
// the pipeline) and the rule id surfaces (counter + response
// header — injection is never silent). The judge runs ON the
// request path: sync, O(1) policy compares — never IO (files are
// read ONCE at build; same non-blocking contract as the bus).
import { readFileSync } from "node:fs";
import { z } from "zod";
import { BucklePrincipalKind } from "../schemas/buckle.principal.zod.ts";
import { ChatRouteSchema } from "../schemas/buckle.route.zod.ts";
import type {
  BuckleContextPolicy,
  BuckleContextRule,
  BuckleSettings,
} from "../schemas/buckle.settings.zod.ts";

/** the facts a judge decides on — server-side truth + the body's
 *  START (first chars: what was asked, from whom) + the fleet
 *  hook's stamps (absent for non-fleet clients; rules that match
 *  on them cannot fire — the trust boundary is the header's
 *  provenance, not the key) */
export const ContextFacts = z
  .object({
    route: ChatRouteSchema,
    principal: z.string().min(1),
    principalKind: BucklePrincipalKind.optional(),
    groups: z.array(z.string().min(1)).optional(),
    model: z.string().min(1),
    /** the body's first bytes — the judging window (never the whole
     *  body; bounded by the pipeline's slice) */
    bodyStart: z.string(),
    repo: z.string().min(1).optional(),
    lane: z.string().min(1).optional(),
    work: z.string().min(1).optional(),
  })
  .strict();
export type ContextFacts = z.output<typeof ContextFacts>;

/** the verdict: TRUE = continue verbatim (default); {system, rule}
 *  = the stanza to inject, the rule that fired (the observability
 *  label) */
type ContextInjection = true | { system: string; rule: string };

/** the seam: any sync predicate can ride (bootServer accepts one);
 *  the shipped default is built from settings (below) */
export type ContextJudge = (facts: ContextFacts) => ContextInjection;

/** THE default — inert: nothing is ever injected unless a rule
 *  says so (zero bytes touched, zero cost) */
export const inertJudge: ContextJudge = () => true;

/** the rule's stanza: text inline, or the file read ONCE at build
 *  (fail loud on unreadable — custody stays at boot, never
 *  on-path; the parked design's repo_file rule rides this same
 *  hole when its ssh custody lands) */
function stanzaOf(rule: BuckleContextRule): string {
  return "text" in rule ? rule.text : readFileSync(rule.file, "utf8");
}

/** one match dimension: absent = the fact cannot veto. EVERY
 *  declared dimension must agree (AND semantics) */
type ContextMatch = NonNullable<BuckleContextRule["match"]>;

/** scalar agreement: an absent matcher field always agrees */
function fieldAgrees<T>(expected: T | undefined, actual: T): boolean {
  return expected === undefined || expected === actual;
}

function matchAgrees(match: ContextMatch, facts: ContextFacts): boolean {
  const checks: boolean[] = [
    fieldAgrees(match.principal, facts.principal),
    match.group === undefined || (facts.groups ?? []).includes(match.group),
    fieldAgrees(match.route, facts.route),
    match.models === undefined || match.models.some((m) => facts.model.startsWith(m)),
    match.bodyContains === undefined || facts.bodyStart.includes(match.bodyContains),
    fieldAgrees(match.repo, facts.repo),
    fieldAgrees(match.lane, facts.lane),
    fieldAgrees(match.work, facts.work),
  ];
  return checks.every(Boolean);
}

/** the shipped judge: FIRST matching rule wins (stanzas resolved at
 *  BUILD — the path is O(1) compares); no policy or no match =
 *  inert (the default verdict, the chain continues) */
export function judgeOf(policy: BuckleContextPolicy | undefined): ContextJudge {
  if (policy === undefined) return inertJudge;
  const rules = policy.rules.map((rule) => ({
    id: rule.id,
    match: rule.match ?? {},
    stanza: stanzaOf(rule),
  }));
  return (facts: ContextFacts): ContextInjection => {
    for (const { id, match, stanza } of rules)
      if (matchAgrees(match, facts)) return { system: stanza, rule: id };
    return true;
  };
}

/** compose from the settings block (the config-over-code face of
 *  the same seam) */
export function judgeFromSettings(settings: BuckleSettings): ContextJudge {
  return judgeOf(settings.context_policy);
}
