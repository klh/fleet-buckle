# Optional engine capability decisions (B12)

Scope: optional LiteLLM capabilities only. Lens, Auto Router, MCP and A2A are required
(B07/B08/B10/B11) and are NOT dispositioned here. No capability below is enabled by this
document; no generator or config change accompanies it (B02 owns the generator).
Basis for all rows: plan.md "Optional capability requirements (B12)" and "Deployment
acceptance requirements". No live matched on/off evidence exists yet; nothing is claimed as proven.

| Option | Decision | Evidence plan | Owner | Rollback |
|---|---|---|---|---|
| 1a Exact-response caching (Redis) | Defer (not enabled) | Needs Redis (B05/B14). Matched on/off: same prompts/keys, off vs on; record hit rate, spend, and zero cross-identity/stale hits (key namespaced by team/key). No fixture exists. | Engine lane (B02 input) | Disable `cache`; flush namespace. |
| 1b Semantic response caching | Reject for agent use until quality study | Agent tool outputs are effectful/non-repeatable. Study: matched on/off with similarity-threshold sweep, measure wrong-hit rate. No test exists. | Owner decision | N/A (not enabled). |
| 2 Provider prompt caching | Defer | Provider-side. Matched on/off with cache-control params; read usage cache-token fields, cost, latency per provider family. No test exists. | Engine lane | Remove cache-control params from model entry. |
| 3 Guardrails (kind: content/PII filtering on LLM I/O only) | Defer | Do not replace Pi tool permission, GitHub effect or test gates; no gap shown. If considered: matched on/off measuring false-positive rate, latency, key/team binding. Tool-permission guardrails Rejected (duplicate authority). | Security/engine lane | Remove guardrail from config and key/team bindings. |
| 4a Batching: batch API | Defer | No bounded Absurd work item/non-interactive workload identified. Matched test: same batch sync vs batch API; cost, completion latency, error rate. | Worker/engine lane | N/A; stop submitting batches. |
| 4b Batching: fastest-response races | Reject (for now) | Race fires duplicate requests; doubles spend and, for tool-calling turns, risks divergent effects. Reconsider only for read-only no-tool calls with matched cost/latency test. | Owner decision | N/A. |
| 5 JSON/reasoning params per provider family | Defer (pass-through only) | Support differs per family (OpenAI-style, Anthropic, Gemini, open-weight/vLLM); documented support is NOT qualified. Per-model matrix needs matched on/off: schema-valid rate, reasoning-token cost, latency. No test exists. | Model catalog owner | Remove param from model entry. |
| 6a Gateway-executed tool: web-search interception | Reject | Side-effect class: external network reads (egress, query leakage, cost) executed inside gateway, outside Fleet idempotency/receipts/writer-epoch. If reconsidered: gateway call id emitted as Pi-visible tool-call event, cost joined via request id/spend log to the Pi turn; matched test required. | Owner decision | N/A; keep interception off. |
| 6b Gateway-executed tool: advisor | Reject | Side-effect class: nested model calls inside gateway; hidden spend and unseen context. If reconsidered: advisor sub-call surfaces as Pi-visible trace span with own spend-log row joined by parent request id; matched on/off quality/cost test required. | Owner decision | N/A; keep off. |
| 7 OTel export | Defer | Decision: content capture default OFF; identity (user/key/team) redacted or hashed before export. Qualify with test that exported spans contain no prompt content or raw identity. Lens covers traces meanwhile. | B07 owner | Disable OTel callback and content logging. |
| 8a Request prioritization | Deferred (source: plan.md B12 card; no workload needs it) | No evidence; revisit with version/license gate and matched load test. | Engine lane | N/A. |
| 8b Routing plugins / advanced routing & identity (beyond required Auto Router) | Deferred (source: plan.md B12 license/version gates) | Verify license/version per feature first; matched on/off required. | Engine lane | N/A. |
| 8c Fusion | Deferred (source: plan.md B12 card) | Not evaluated; needs own study before any enable. | Owner decision | N/A. |

Nothing is enabled; documented support is not treated as qualified.

## Matched on/off evidence plan (required before ANY row becomes Enable)

1. Open a bounded Absurd work item with owner, source-of-truth decision and rollback step.
2. Run identical workload (same prompts, models, keys, seed) with feature off then on, on pinned images.
3. Record: latency/first-token, cost/spend, error/fallback rate, quality diff, identity isolation.
4. Verify license/version gate; review config input with B02.
5. Rehearse rollback; record result here, then change disposition.

Currently enabled features: none.
