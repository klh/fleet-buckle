# 0005 — OTel + Jaeger through everything; Prometheus /metrics

Full OpenTelemetry is the law for BOTH repos: W3C traceparent ids flow
through every request — buckle faces, the MITM forward loop, AND every
downstream federation hop (identity travels downstream; so do traces).
Spans export OTLP to Jaeger (compose unit ships jaeger/all-in-one; the
stack sets OTEL_EXPORTER_OTLP_ENDPOINT). fleet-health stays simple: it
sends a fresh traceparent with every probe and stamps the trace id in
each verdict sample — no SDK; buckle continues those traces.

buckle additionally exposes a Prometheus `/metrics` face (text format):
requests, inflight, tok/s — per model, per provider, per buckle, plus
federated peer rollups. Scraped, not pushed.
