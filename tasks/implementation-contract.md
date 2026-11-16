# Implementation contract — standalone Fleet rollout

This file bounds `plan.md`; it is not a second work ledger. The owner's
current directions and each repository's own AGENTS.md govern its edits.
The fleet monorepo's package layout, config format, dependency policy,
test framework, stack version, and installed source paths do not become
fleet-buckle rules. Use fleet-buckle's own laws and public wire contracts.

## Repository ownership

| Responsibility                                                                                      | Implementation home                                                                     | Buckle boundary                                            |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Federation, live catalog, context policy, request identity and tracking                             | `fleet-buckle`                                                                          | Existing capability folders and schemas                    |
| Provider translation, deployment aliases, balancing, fallback, budgets and native per-user controls | LiteLLM configuration/API                                                               | Reuse engine features; no parallel implementation          |
| Entra admission, group/access policy, identity stamping and backend isolation                       | APIM deployment policy                                                                  | Buckle consumes a verified identity contract               |
| Browser login, Entra cache/refresh, CLI settings installation                                       | Separate client tooling for org rollout; isolated manual script allowed for owner pilot | No MSAL/browser/token-cache runtime in Buckle              |
| Pi Durable sessions, seeds, tools, journals, microVM runners and child agents                       | Standalone `fleet-worker`                                                               | Model HTTP requests and published schemas/images only      |
| Job admission, scheduling, leases, recovery and operator control                                    | Fleet Suspenders                                                                        | Consume worker contracts; no supervisor inside Buckle      |
| Trials and seed optimization                                                                        | BLAM                                                                                    | Consume outcome artifacts; no benchmark loop inside Buckle |
| Knowledge and Absurd experiments                                                                    | Deferred to their own owners                                                            | No Phase 0 implementation                                  |

Existing `src/agents/` and `deploy/worker/` are migration debt, not
precedents for new gateway features. Change the legacy worker only for
the bounded Phase 0 proof or extraction. Add new runner/seed/supervisor
functionality in fleet-worker after extraction. Do not copy source from
the fleet monorepo into Buckle, add sibling filesystem dependencies, or
make Buckle's build/install require a monorepo checkout.

## Credential and deployment boundaries

Human BYOC relays the caller's URL/Bearer PAT. The owner-worker pilot
may use a separate engine-held mode: its dedicated LiteLLM engine alone
mounts the owner's PAT; Buckle carries an engine key. Record the mode
and owner admission identity in each receipt; never switch modes on an
auth failure or use the worker credential for a human BYOC call.
Bootstrap supplies admission credentials; Buckle does not become a
login/token broker. Fallback targets are configured authorized Buckles
with the same identity/grant contract, never direct provider endpoints.

Qualify the latest LiteLLM candidate through the existing tests, then
deploy its immutable digest with the previous digest retained for rollback.
Worker startup, journal storage and the eight-worker crash demonstration
belong to fleet-worker deployment tooling and Suspenders integration.
ACR publication is preparation; the explicit stop/redeploy and durable
journal remount are the tested failure/recovery actions.

## Lane brief required before edits

Each implementation item names one repository, one behavior, an exact
write allowlist, the existing construction sites to reuse, dependencies,
verification commands, and a rollback. Read access to another repository
does not grant write scope. Work in that repository's isolated checkout;
exclude unrelated dirty changes from the delivery. A cross-repository
change becomes separate linked items communicating over a versioned wire
contract or immutable image, never a shared source tree.

Keep each item to one behavior and normally at most five source files
plus their tests. Expand the brief before expanding scope. A missing
engine feature is a measured gap to report, not permission to implement
an identity server, provider adapter, scheduler, or new framework.
Define extension schemas once; preserve opaque LiteLLM payload fields,
headers, endpoint families, and streaming unless a named context policy
or credential boundary requires a specific change.

Before delivery, inspect the diff for new dependencies, exports, knobs,
filesystem imports, model rewrites, copied code, guard exemptions, and
new responsibilities. Each must be necessary for the assigned behavior.
Keep gates at least as strict as the baseline. Do not suppress findings,
raise limits, or weaken tests to land a slice. A failed existing gate
needs reproducible baseline evidence, not a claim that it is unrelated.

## Dispatch sequence for Phase 0

These are brief boundaries, not additional work IDs. Register ownership
in the work graph used by the implementing repository. Later phases are
a roadmap; a Phase 0 assignment does not authorize implementing them.

| Slice                          | Owner and permitted area                                                      | Exit evidence                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A. Characterize current chain  | Buckle; read-only source/runtime inspection and a test receipt                | Actual VMSS/engine version, license, current BYOC wire, failing/passing endpoint cases and clean-checkout gate baseline                |
| B. Fix credential contract     | Contract review before auth code                                              | Exact Entra/PAT carriers, APIM identity fields, trusted backend boundary, engine credential/user binding and conflict/error behavior   |
| C. Prove engine credentials    | Buckle engine generator/config and existing engine tests                      | Human BYOC uses isolated synthetic caller PATs; worker engine-held mode is separate and cannot act as human fallback; no model rewrite |
| D. Add generic gateway binding | Buckle access/settings/proxy seams and their tests, exact files chosen from A | URL and Bearer PATs, verified user attribution and denial/spoof tests; no Entra login runtime                                          |
| E. Configure APIM              | Deployment policy/profile only; runtime values outside source                 | Model API access enforced, both carriers accepted, direct backend bypass denied, verified user identity forwarded                      |
| F. Pilot login script          | Isolated `test/manual/entra-login/` package; no gateway imports/dependencies  | Browser MFA, API token, temporary CLI settings and APIM preflight; rerun on expiry                                                     |
| G. Verify Claude CLI           | Client test setup plus published Buckle/engine images                         | Settings JSON, catalog, Messages, tools, streaming and model switch on Azure; script rerun proves pilot expiry recovery                |
| H. Prove legacy worker cycle   | Existing `deploy/worker` and cycle test only                                  | Catalog-selected model, real PR, restart recovery; no new supervisor/runner features                                                   |

Do A, then B. C and D use B's contract; E and F use the same contract.
G follows C–F; H follows G. Engine and access settings share files, so
C/D must serialize edits or reserve disjoint files before implementation.
H consumes the separately owned `.prefer` lane's changes; do not assign
a second implementation of worker model selection. P1 requires only
the owner-pilot exit. ORG.1, two live user accounts and automatic renewal
gate general org access and do not block extraction or the worker demo.
Do not dispatch a single lane to "implement P0". The first executable
assignment is A; B must be concrete before C–F can be dispatched.

## Decisions and enforcement before feature dispatch

B must record the exact header/path matrix for URL PAT, Bearer PAT,
Entra admission and peer/engine authentication; treatment of duplicate
credentials; and preservation of the verified user across each hop.
Test the deployed LiteLLM mechanism before selecting a user binding.
Do not build substitute user management when a version/license gap is
found. Keep the owner pilot limitation explicit until the binding works.
Assign the APIM deployment artifact owner before E. The owner pilot may
use the isolated Node/Bun script in `test/manual/entra-login/` for F;
it needs no permanent client repository, automatic refresh or shared
token cache. Use browser MFA, an API-scoped access token, private
temporary CLI settings, and explicit rerun on expiry. Keep its package
and dependencies isolated from Buckle runtime. Assign a separate client
home when implementing org auth; no default placement in Buckle `src/`
or the fleet monorepo. Tenant, audience and real values stay runtime data.

Before multiple feature lanes start, land a focused boundary-guard item
in Buckle's existing `tools/src/buckle.laws.*`/check pipeline: reject new
source/dependency paths into fleet or sibling checkouts, and ratchet
legacy worker/agent/seed paths and dependencies against a reviewed
baseline so extraction can shrink them. Test the guard with forbidden
and allowed fixtures. Keep the current product capability folders and
the existing test frameworks; do not create a replacement policy tool.
Semantic ownership still requires diff review; a path scan cannot detect
a scheduler hidden in a proxy file.

Buckle verification uses its own `typecheck`, `check`, unit, smoke and
relevant Docker/e2e scripts plus qlty. The current qlty smell/plugin modes
and several ESLint size rules are warnings/comments, not hard failure
gates. Review findings on changed code; a zero exit alone proves no
architectural boundary. Cross-repository integration consumes published
immutable images and records each source SHA. No Docker result is an
Azure deployment receipt.

Dispatch references a committed handoff revision containing AGENTS.md,
this contract, the rollout and the superseded-document banners together.
Local untracked plans are not available to another checkout. If agents
receive a published package instead of a checkout, include the required
instruction documents in that artifact; the current package file list
does not include `tasks/`. Verify those links in the actual lane input.
