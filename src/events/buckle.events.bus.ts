// events/buckle.events.bus.ts — the INTERNAL event bus: the request
// pipeline's ONE write seam. Legs emit what happened
// (opened/served/failed, parsed through the event schema at emit —
// drift fails loud); collectors subscribe at boot and gather
// asynchronously from the API surfaces' point of view. NON-BLOCKING
// BY CONTRACT: emit() is a synchronous fan-out to in-memory handlers
// only — a subscriber must be O(1) bookkeeping (self-buffer if it
// needs to await; never block a face).
import { z } from "zod";
import { BucklePrincipalKind } from "../schemas/buckle.principal.zod.ts";
import { pick } from "../pick.ts";

/** the fault KINDS (the taxonomy's discriminants, mirrored here as
 *  the event payload — the named set the pipeline can report) */
const FaultKind = z.enum(["timeout", "unreachable", "denied", "malformed", "io"]);

/** which leg carried the request */
const LegKind = z.enum(["engine", "hop"]);

/** what actually happens on the forward path — three named event
 *  schemas (the constructors derive from THESE, never a hand-typed
 *  mirror), one union over them */
const OpenedEventSchema = z
  .object({
    kind: z.literal("request.opened"),
    at: z.number().int(),
    principal: z.string().min(1),
    principalKind: BucklePrincipalKind.optional(),
    model: z.string().min(1),
  })
  .strict();
const ServedEventSchema = z
  .object({
    kind: z.literal("request.served"),
    at: z.number().int(),
    principal: z.string().min(1),
    model: z.string().min(1),
    leg: LegKind,
    peer: z.string().optional(),
    status: z.number().int(),
    tokens: z.number().int().min(0),
    latencyMs: z.number().int().min(0),
  })
  .strict();
const FailedEventSchema = z
  .object({
    kind: z.literal("request.failed"),
    at: z.number().int(),
    principal: z.string().min(1),
    model: z.string().min(1),
    leg: LegKind,
    peer: z.string().optional(),
    fault: FaultKind,
    latencyMs: z.number().int().min(0),
  })
  .strict();
const InjectedEventSchema = z
  .object({
    kind: z.literal("context.injected"),
    at: z.number().int(),
    principal: z.string().min(1),
    model: z.string().min(1),
    /** the fired rule's id — the observability label */
    rule: z.string().min(1),
  })
  .strict();

export const BuckleEvent = z.discriminatedUnion("kind", [
  OpenedEventSchema,
  ServedEventSchema,
  FailedEventSchema,
  InjectedEventSchema,
]);
export type BuckleEvent = z.output<typeof BuckleEvent>;
export type FaultKindValue = z.output<typeof FaultKind>;
/** the leg values — the shared named type (never inline z.output) */
export type Leg = z.output<typeof LegKind>;

/** the subscriber contract: sync, fast, never throws into a face */
export type EventSubscriber = (event: BuckleEvent) => void;

export function createEventBus() {
  const subscribers: EventSubscriber[] = [];
  return {
    /** attach a collector; the bus owns order, the subscriber owns speed */
    subscribe(fn: EventSubscriber): void {
      subscribers.push(fn);
    },
    /** the pipeline's ONE write: parse-validated fan-out */
    emit(event: BuckleEvent): void {
      const parsed = BuckleEvent.parse(event);
      for (const fn of subscribers) fn(parsed);
    },
  };
}
export type EventBus = ReturnType<typeof createEventBus>;

/** the event CONSTRUCTORS — the one home per kind: the event minus
 *  its kind in (DERIVED from the schema — never a hand-typed mirror),
 *  a parsed event out. The omit-when-absent spreads live here and
 *  nowhere else; emitters never hand-assemble event literals. */
type OpenedEventInput = Omit<z.output<typeof OpenedEventSchema>, "kind">;
type ServedEventInput = Omit<z.output<typeof ServedEventSchema>, "kind">;
type FailedEventInput = Omit<z.output<typeof FailedEventSchema>, "kind">;

export function openedEventOf(input: OpenedEventInput): BuckleEvent {
  const { principalKind, ...rest } = input;
  return OpenedEventSchema.parse({
    kind: "request.opened",
    ...rest,
    ...pick("principalKind", principalKind),
  });
}

export function servedEventOf(input: ServedEventInput): BuckleEvent {
  const { peer, ...rest } = input;
  return ServedEventSchema.parse({
    kind: "request.served",
    ...rest,
    ...pick("peer", peer),
  });
}

export function failedEventOf(input: FailedEventInput): BuckleEvent {
  const { peer, ...rest } = input;
  return FailedEventSchema.parse({
    kind: "request.failed",
    ...rest,
    ...pick("peer", peer),
  });
}

type InjectedEventInput = Omit<z.output<typeof InjectedEventSchema>, "kind">;

export function injectedEventOf(input: InjectedEventInput): BuckleEvent {
  return InjectedEventSchema.parse({ kind: "context.injected", ...input });
}
