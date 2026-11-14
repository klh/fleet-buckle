// metrics/buckle.metrics.exposition.ts — the Prometheus face: a per-server registry
// of counters per {buckle, model}, rendered in Prometheus text format.
// Scraped, not pushed; /metrics serves exactly this render.
import type { BuckleEvent, EventBus, EventSubscriber } from "../events/buckle.events.bus.ts";

export type MetricsRegistry = ReturnType<typeof createMetrics>;

/** the exposition as a BUS SUBSCRIBER — a served request counts its
 *  model (failures surface through the problem faces, not here). */
export function subscribeExposition(bus: EventBus, metrics: MetricsRegistry): void {
  const collect: EventSubscriber = (event: BuckleEvent): void => {
    if (event.kind === "request.served") metrics.countRequest(event.model);
  };
  bus.subscribe(collect);
}

export function createMetrics(buckle: string) {
  const requests = new Map<string, number>();
  return {
    countRequest(model: string): void {
      requests.set(model, (requests.get(model) ?? 0) + 1);
    },
    render(): string {
      const lines: string[] = [
        "# TYPE buckle_requests_total counter",
        "# requests forwarded per model (Prometheus export — law: /metrics)",
      ];
      for (const [model, value] of [...requests.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
        lines.push(
          `buckle_requests_total{buckle="${buckle}",model="${model}"} ${value}`,
        );
      }
      lines.push(`buckle_up{buckle="${buckle}"} 1`);
      return `${lines.join("\n")}\n`;
    },
  };
}
