# 0005 — OpenTelemetry propagation and Prometheus metrics

W3C traceparent flows through Buckle ingress, the model forward loop and downstream federation.
Configured OTLP export is independent of wire propagation. Existing local Compose may use Jaeger;
the production Lens/ClickHouse target and agent trace correlation belong to B06/B07 in
[the plan](../../tasks/plan.md). Jaeger is not a prerequisite for the Lens deployment.

Buckle exposes a Prometheus metrics face for traffic and overview. Pi owns its execution receipts;
LiteLLM supplies deployment attempts and spend evidence. Missing token/cost observations stay
unknown. Outside-process health probes carry trace IDs but never infer useful agent work from a
heartbeat or successful scrape.
