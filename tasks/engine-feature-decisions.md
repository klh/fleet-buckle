# Optional engine capability decisions (B12)

Scope: optional LiteLLM capabilities only. Lens, Auto Router, MCP and A2A are required
(B07/B08/B10/B11) and are NOT dispositioned here. No capability below is enabled by this
document; no generator or config change accompanies it (B02 owns the generator).
Basis for all rows: plan.md "Optional capability requirements (B12)" and "Deployment
acceptance requirements". No live matched on/off evidence exists yet; nothing is claimed as proven.

| Capability | Disposition | Evidence basis | Owner | Rollback |
|---|---|---|---|---|
| Exact-response caching (Redis) | Defer | Plan: exact-response and provider prompt caching are distinct. Needs Redis (B05/B14) and a matched on/off run showing hit rate and no stale/cross-identity responses. No evidence yet. | Engine lane (B02 config input) | Not enabled; if enabled later, disable `cache` setting and flush namespace. |
| Provider prompt caching | Defer | Provider-side; measure via usage cache-token fields in matched runs. No evidence yet. | Engine lane | Remove cache-control params. |
| Semantic response caching | Reject (for agent use) until study | Plan requires a dedicated quality study before agent use; agent tool outputs are effectful and non-repeatable. Reconsider only after study. | Owner decision | N/A (not enabled). |
| Guardrails (LiteLLM) | Defer | Plan: they do not replace Pi tool permission, GitHub effect or test gates; no gap shown that they would close. | Security/engine lane | N/A; if enabled, remove guardrail from config and key/team bindings. |
| Advanced routing/identity (beyond required Auto Router; e.g. pass-through auth, advanced SSO) | Defer | Plan: license and version gates must be verified per feature first. | Engine lane | N/A. |
| Batching (batch API) | Defer | No bounded Absurd work item or non-interactive workload identified. | Worker/engine lane | N/A. |
| JSON mode / structured output / reasoning params | Defer (pass-through only) | Per-model support varies; pass-through of client params is not an engine feature to enable. Enable per model only with matched on/off test. | Model catalog owner | Remove param from model entry. |
| Gateway-executed tools: web-search interception | Reject | Would run side-effecting tools outside Fleet idempotency, receipts and writer-epoch checks. | Owner decision | N/A. |
| Gateway-executed tools: advisor | Reject | Same authority concern; not required by plan. | Owner decision | N/A. |
| OTel content capture/export | Defer | Plan: qualify content capture and identity redaction before export; Lens (required) covers traces. | B07 owner | Disable content logging. |

## Matched on/off evidence plan (required before ANY row becomes Enable)

1. Open a bounded Absurd work item with owner, source-of-truth decision and rollback step.
2. Run identical workload (same prompts, models, keys, seed) with feature off then on, on pinned images.
3. Record: latency/first-token, cost/spend, error/fallback rate, quality diff, identity isolation.
4. Verify license/version gate; review config input with B02.
5. Rehearse rollback; record result here, then change disposition.

Currently enabled features: none.
