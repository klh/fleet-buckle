# pi-durable examples — the vendored teaching corpus

The 38 numbered runnables (`00-conversation.ts` … `37-harness-registry.ts`)
are copied **verbatim** from
[`earendil-works/pi` `v1.5.0`](https://github.com/earendil-works/pi/tree/v1.5.0/packages/durable/test/examples)
— the upstream test suite for `@earendil-works/pi-durable`, which this
worker runs (see `worker.durable.ts`). They are the canonical tour of the
durable runtime: conversations, documents, forks, owned conversations,
watches, the harness, configuration, harness conversations, context,
registry reload, extension state, tasks, recovery, subagents (foreground,
background, parallel children), compaction, coding tools, sandboxing,
approval gates, transcripts, signals, and webhook/poll-waiting tools.

## Provenance and pinning

Copied from tag `v1.5.0` — **the exact version pinned in this package's
`package.json`**. The corpus at `main` is ahead of the pin (48 files;
newer APIs like `hookTask`); vendored examples must match the vendored
package, so the tag, not the branch, is the source. Do not hand-port
newer examples without bumping the dependency.

## Local rewrites (the only deltas vs upstream)

- import paths: `../../src/…` → `@earendil-works/pi-durable/…` (package
  imports, per this repo's import law)
- run-line comments: `node --conditions=source --experimental-strip-types …`
  → `bun deploy/worker/examples/…`
- three mechanical strictness fixes that change no semantics:
  index-signature bracket access (`process.env["OPENAI_API_KEY"]`,
  `.agents["researcher"]`) and one `exactOptionalPropertyTypes` key
  omission in `22-subagent-background.ts`
- formatting normalized to this repo's biome config (upstream uses tabs)

The type law (zod-derive) exempts this directory: the files document
upstream idioms in upstream style — rewriting them to this repo's laws
would misrepresent the API they teach. New code does **not** get this
exemption.

## Running

From the repo root (bun resolves the workspace install):

```bash
bun deploy/worker/examples/00-conversation.ts
```

Most examples are hermetic (faux providers, in-memory storage). Those
needing a real model say so in their header comment (`needs
OPENAI_API_KEY`): `15-real-model.ts`, `17-print.ts`, `18-json.ts`,
`21-subagent-foreground.ts`, `22-subagent-background.ts`.

The corpus is typechecked by `deploy/worker/tsconfig.json` via the root
`bun run typecheck` — API drift against the pinned package fails loudly
there.
