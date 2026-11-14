// metrics/buckle.metrics.exposition.ts — the Prometheus face: a per-server registry
// of counters per {buckle, model}, rendered in Prometheus text format.
// Scraped, not pushed; /metrics serves exactly this render.
import type { BuckleEvent, EventBus, EventSubscriber } from "../events/buckle.events.bus.ts";

export type MetricsRegistry = ReturnType<typeof createMetrics>;

/** the exposition as a BUS SUBSCRIBER — a served request counts its
 *  model, a fired context rule counts its injection (failures
 *  surface through the problem faces, not here). */
export function subscribeExposition(bus: EventBus, metrics: MetricsRegistry): void {
  const collect: EventSubscriber = (event: BuckleEvent): void => {
    if (event.kind === "request.served") metrics.countRequest(event.model);
    else if (event.kind === "context.injected") metrics.countInjection(event.rule);
  };
  bus.subscribe(collect);
}

/** a sorted counter series → exposition lines (stable order, never
 *  empty); `render` emits the full labeled sample per key */
const seriesLines = (
  name: string,
  help: string,
  counts: Map<string, number>,
  render: (key: string, value: number) => string,
): string[] => [
  `# TYPE ${name} counter`,
  help,
  ...[...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => render(key, value)),
];

export function createMetrics(buckle: string) {
  const requests = new Map<string, number>();
  const injections = new Map<string, number>();
  return {
    countRequest(model: string): void {
      requests.set(model, (requests.get(model) ?? 0) + 1);
    },
    countInjection(rule: string): void {
      injections.set(rule, (injections.get(rule) ?? 0) + 1);
    },
    render(): string {
      const lines = [
        ...seriesLines(
          "buckle_requests_total",
          "# requests forwarded per model (Prometheus export — law: /metrics)",
          requests,
          (model, value) => `buckle_requests_total{buckle="${buckle}",model="${model}"} ${value}`,
        ),
        ...seriesLines(
          "buckle_context_injections_total",
          "# context stanzas injected per rule (injection is never silent)",
          injections,
          (rule, value) =>
            `buckle_context_injections_total{buckle="${buckle}",rule="${rule}"} ${value}`,
        ),
        `buckle_up{buckle="${buckle}"} 1`,
      ];
      return `${lines.join("\n")}\n`;
    },
  };
}
