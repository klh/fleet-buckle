// proxy/buckle.proxy.ctx.ts — the FORWARDING CONTEXT: the
// request-independent half of every forward (who is asking, under
// which settings, with which observability and secret reader),
// assembled ONCE per face call.
import type { BuckleSettings } from "../schemas/buckle.settings.zod.ts";
import type { EventBus } from "../events/buckle.events.bus.ts";
import { inertJudge, type ContextJudge } from "../context/buckle.context.judge.ts";
import { pick } from "../pick.ts";
import type { TokenReader } from "../federation/buckle.federation.peer.ts";
/** the FORWARDING CONTEXT — the request-independent half of every
 *  forward: who is asking, under which settings, with which
 *  observability and secret reader. The factory's real job: resolve
 *  the principal's KIND from the registry ONCE (absent row = no kind
 *  — the tracker renders the row without one). Factory-typed (the
 *  codebase idiom for live values: ReturnType of the one
 *  constructor — never a fake z.custom parse).
 *
 *  userToken: the caller's /w/<lane>/<token> BYOC credential when
 *  present (null otherwise) — a SECRET: it rides the user_token
 *  provider leg as the upstream Bearer and NOTHING else (never an
 *  event, never a log, never a response). */
export function createForwardCtx(parts: {
  settings: BuckleSettings;
  bus: EventBus;
  judge?: ContextJudge;
  principal: string;
  tokenOf: TokenReader;
  userToken: string | null;
}) {
  const row = parts.settings.access?.principals.find((p) => p.id === parts.principal);
  // the judge defaults INERT: no injection unless a policy says so
  return {
    judge: inertJudge,
    ...parts,
    ...pick("kind", row?.kind),
    ...pick("groups", row?.groups),
  } as const;
}
export type ForwardCtx = ReturnType<typeof createForwardCtx>;
