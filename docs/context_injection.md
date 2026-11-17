# Context injection

This page describes the current source seam. It does not add a delivery backlog; gateway changes
follow [the plan](../tasks/plan.md) and repository laws.

The pipeline invokes the synchronous judge for originating requests. Incoming federated hops are not
judged again. `src/context/buckle.context.judge.ts` defines the named Zod `ContextFacts` schema and
`judgeFromSettings`; `src/context/buckle.context.inject.ts` owns body rewriting.

## Current settings contract

`BuckleContextPolicy` in `src/schemas/buckle.settings.zod.ts` accepts a nonempty `rules` array. Each
rule has an ID, optional match fields and exactly one of `text` or `file`. File content is read at
boot; unreadable files fail boot. First matching rule wins. Every declared match dimension must
agree; no policy or no matching rule returns the inert verdict.

Match fields include principal, group, route, models, bodyContains, repo, lane and work. Current
model matching uses `startsWith` on configured prefixes. Facts come from authenticated identity,
route/body metadata and optional request headers. A repo/lane/work header is metadata, not proof of
permission; ingress must establish its provenance before using it for a privileged policy. Do not
assume the former `inject` array or proposed `repo_file`/SSH-fetch configuration exists.

## Current rewrite boundary

A verdict is `true` for no injection, or `{system, rule}` for a stanza and its rule ID. The body
helper has chat, Messages and Responses branches. It preserves unrecognized/malformed shapes; the
owning route still validates the request. Chat merges a leading system message; Messages uses
top-level system; Responses uses instructions. Check the actual helper and wire tests before
claiming parity for a provider-specific body shape. The lane model-pin rewrite is a separate
operation.

Pure helper tests, judge/settings tests and the Docker observed-body oracle verify behavior. The
schema and source are authoritative for field names; this document supplies the boundary and read
path rather than a second copy of the schema. New injection features need their own task, test,
credential policy and observable rule receipt; old design proposals are not authorization.
