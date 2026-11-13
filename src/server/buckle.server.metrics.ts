// buckle.server.metrics.ts — the Prometheus face: a per-server registry
// of counters per {buckle, model}, rendered in Prometheus text format.
// Scraped, not pushed; /metrics serves exactly this render.
export type MetricsRegistry = ReturnType<typeof createMetrics>;

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
