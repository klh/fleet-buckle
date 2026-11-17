# Gateway decomposition inventory (B00)

Frozen inventory for B03/B04/B05/B06/B09/B13. Owner of this file: B00 only.
Inventory only; no runtime edits. Engine faces stay in the engine (AGENTS.md port doctrine).
Imports below were read from the tree at authoring time; re-run
`grep -rn "from \"\.\./" src/<dir>` before relying on them.

## 1. Entry faces: src/main.ts
`main.ts` is the serving shell (one Bun.serve, "METHOD path" route table, trace/span scaffold, auth).
It imports: access.registry, admission.limits, catalog.topology, catalog.view, context.judge,
events.bus, lane, metrics.{exposition,tracker,stats,engine}, pick, proxy.{ctx,pipeline,passthrough},
admin.control, trace.export, settings, schemas {access,healthz,settings}.
`src/index.ts` and `src/schemas/index.ts` are barrels. main.ts is SHARED: edits are rows in the route
table only, serialized through the shared-file table (section 5).

## 2. Capability folders (reachable modules and cross-imports)
| Folder | Modules | Imports out of folder |
|---|---|---|
| src/catalog | fetch, topology, view (+tests) | schemas settings/model.wire/tree/access/provider.registry, federation.peer, trace.export, kit |
| src/proxy | ctx, gate, pipeline, engine, hop, outcome, settle, passthrough, userleg (+tests) | catalog.view, context.{judge,inject}, events.bus, federation.{peer,protocol}, trace.export, fault, problem, lane, pick, schemas {settings,model.wire,route,fault,provider.registry} |
| src/access | registry (+test) | schemas access/settings/problem/model.wire, settings, kit |
| src/admission | limits (+test) | schemas access/problem, kit |
| src/admin | control (+test) | settings, schemas settings/problem/access, kit |
| src/federation | peer, protocol | trace.export, schemas settings/fault, fault |
| src/metrics | exposition, tracker, stats, engine, window (+tests) | schemas stats/settings/principal, events.bus, federation.peer, pick, settings, kit |
| src/trace | export | schemas settings, fault |
| src/events | bus (+test) | schemas principal/fault, pick |
| src/context | judge, inject (+tests) | schemas settings/route/principal, fault |
| src/schemas | access, fault, route, provider.registry, principal, limits, healthz, settings, model.wire, problem, tree, stats zod; openapi; index | settings.zod imports deploy/settings/default.settings.json5 and (agents path) src/agents |
| src root | fault, problem, kit, lane, pick, settings, main, index | — |

Route map: main.ts -> proxy.pipeline.forwardChat (gate -> userleg/engine/hop -> settle/outcome);
passthrough for non-chat engine paths; catalog.view/topology for catalog+tree; metrics.* for
/metrics,/stats; admin.control for key mint/hub edit.

## 3. src/agents (B13 delete target)
Copied Pi seed/writer runtime: agents.{paths,seed,guard,zod,writer}. Imports: fault, node:fs/sqlite,
crypto, path, zod, @earendil-works/pi-ai. Referenced from outside by: `src/schemas/buckle.settings.zod.ts`,
`src/lane.test.ts`, `tools/src/buckle.laws.boundary.ts` (+test). B13 deletes the folder and fixes those
references; nobody else edits src/agents (extraction debt, no growth).

## 4. Engine config, seeds, overlays, consumers, test projects
- tools/src/buckle.gen-engine-config.ts: stub mode (fixtures -> test/deploy/engine) and `--real`
  (live catalog -> deploy/engine/mscopilot.litellm.yaml, generated); imports schemas provider.registry.
  Other tools: check-laws, laws.{boundary,images,scan,shapes}, gen-openapi, mint-keys, keys.mint,
  azure-mint, capture-fixtures, real, hook.pre-commit.
- Seeds: src/agents/buckle.agents.seed.ts, deploy/engine/tokens (pre-seeded token cache),
  buckle-source-map.json / buckle-source-entries.json.
- Live overlays: deploy/settings/{default,azure,azure.over,azure.health,b1}.settings.json5,
  deploy/compose.azure.yaml, deploy/compose.yaml, deploy/engine/mscopilot.litellm.yaml.
- Consumers: deploy/gui (gui.main/session/oidc, own package), deploy/front, openapi.json,
  test/manual/entra-login.
- Playwright projects (playwright.config.ts): unit (src, *.spec.ts), stack-setup/teardown, smoke,
  stage0, e2e, azure, federation, load, rolling. Bun unit tests: src/**/*.test.ts, tools/src/*.test.ts.
  Test dirs: test/{deploy,e2e,federation,fixtures,kit,load,manual,rolling,setup,smoke}.

## 5. Reservations (disjoint) and shared-file ownership
Each file has exactly one owner. Colocated `*.test.ts` follow their source file.

| Package | Exact files reserved |
|---|---|
| B03 model-wire | src/schemas/buckle.model.wire.zod.ts, src/schemas/buckle.route.zod.ts, src/schemas/buckle.provider.registry.zod.ts, src/proxy/buckle.proxy.gate.ts, src/proxy/buckle.proxy.userleg.ts (+userleg.test.ts) |
| B04 access-identity | src/access/buckle.access.registry.ts(+test), src/schemas/buckle.access.zod.ts(+test), src/schemas/buckle.principal.zod.ts, src/schemas/buckle.limits.zod.ts, src/admission/buckle.admission.limits.ts(+test), src/admin/buckle.admin.control.ts(+test), src/lane.ts(+test) |
| B05 retry-deadline | src/proxy/buckle.proxy.engine.ts(+test), src/proxy/buckle.proxy.hop.ts(+test), src/proxy/buckle.proxy.outcome.ts, src/proxy/buckle.proxy.settle.ts, src/proxy/buckle.proxy.passthrough.ts, src/federation/buckle.federation.peer.ts, src/federation/buckle.federation.protocol.ts, src/fault.ts, src/schemas/buckle.fault.zod.ts |
| B06 metrics-trace | src/metrics/* (exposition, tracker, stats, engine, window + tests), src/trace/buckle.trace.export.ts, src/events/buckle.events.bus.ts(+test), src/schemas/buckle.stats.zod.ts |
| B09 decision catalog+proxy | src/catalog/* (fetch, topology, view + tests), src/schemas/buckle.tree.zod.ts(+test), src/proxy/buckle.proxy.pipeline.ts(+test), src/proxy/buckle.proxy.ctx.ts, src/context/* (judge, inject + tests), src/schemas/buckle.healthz.zod.ts |
| B13 | src/agents/* (delete) |

Shared / serialized files (NOT reserved by any feature package; edit only via a rebase-first
single-row change, announced on the owning issue, one package at a time):
src/main.ts, src/main.test.ts, src/index.ts, src/schemas/index.ts, src/schemas/buckle.settings.zod.ts(+test),
src/settings.ts(+test), src/schemas/buckle.openapi.ts, src/schemas/buckle.problem.zod.ts, src/problem.ts(+test),
src/kit.ts, src/pick.ts, openapi.json (generated via `bun run gen:openapi`), tools/src/*, deploy/**,
test/**, playwright.config.ts, package.json, bun.lock. Engine config generation and deploy overlays
belong to B02; B13 also touches settings.zod.ts and tools/src/buckle.laws.boundary.ts(+test) for agents removal.

## 6. Live deployment observation basis (all TO-REFRESH for B02, not fact)
Sources: deploy/compose.azure.yaml and historical notes in tasks/plan.md (~lines 400, 595, 636-665).
| Question | Recorded observation | Status |
|---|---|---|
| engine.url | default.settings.json5 has `engine: { url: "http://127.0.0.1:4000" }`; azure.over.json5 is `{}`; compose names the service `engine` (port 4000). Whether the live /state/over.json5 sets `engine:4000` is unverified. | TO-REFRESH for B02 |
| keys.engine mount | default `keys.engine` = /etc/buckle/keys/engine.key; b1 uses engine.master.key; compose.azure mounts only settings and `state:/state`, and the mint step writes principal/session keys in /state/keys. Mount gap per plan.md. | TO-REFRESH for B02 |
| Digest pinning | compose.azure.yaml pins litellm `@sha256:bd089afd...5fd7` (comment v1.103.0); health uses git tag `#v1.0.0` (not a digest); buckle image digest not recorded. Running digest unverified. | TO-REFRESH for B02 |
| Engine telemetry | No DATABASE_URL, metrics port, callbacks or router_settings in compose (per plan.md). | TO-REFRESH for B02 |
