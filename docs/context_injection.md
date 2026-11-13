# Context injection — parked design (approved direction A, not yet built)

Status: DESIGN ONLY. This is the port target for fleet-buckle (the
standalone repo) from the fleet monorepo's W3081 `context-inject.ts`
prior art, extended with the full decision matrix. Nothing here is
implemented yet; do not wire until the plan is picked up deliberately.

## The law this serves

Buckle is a MITM interface over the engine: everything forwards
byte-identical EXCEPT what a declared context policy matches. An
absent or non-matching policy is INERT — zero bytes touched, zero
cost, zero observability noise. Injection is never silent: the lane
can always see THAT something was injected (never the content).

## Decision inputs — RequestFacts

Per request, buckle composes a typed `RequestFacts` (zod-derived,
one shape, no hand-written types):

| fact | source | notes |
|---|---|---|
| `request` | the route itself | `chat`, `embed`, … — server-side truth |
| `principal` | the bearer key | id + kind + groups from the registry |
| `repo` | `x-fleet-repo` header | stamped by the fleet CLI hook (we control the CLI wiring; trust = we minted both ends + key identifies caller) |
| `lane` | `x-fleet-lane` header | lane label, same provenance |
| `work` | `x-fleet-work` header | work item id, optional |
| `model` | request body | the requested model id |
| `hub` | routing | unit label + resolved provider |

No request signing: the fleet controls the CLI hook layer that adds
the headers, and the principal key already authenticates the caller.
A header set absent (non-fleet client) simply yields absent facts —
rules that match on them cannot fire.

## Policy — config over code (JSON5, settings block)

```
context_policy: {
  // PATHS, never values; read ONCE at boot (fail loud on unreadable)
  ssh_key: "/etc/buckle/keys/deploy.key",
  rules: [
    {
      id: "fleet-law-to-agents",
      match: { repo: "klh/fleet", principal: "alice@fleet", request: "chat" },
      inject: { repo_file: "AGENTS.md" },
    },
    {
      id: "glm-gets-the-standard",
      match: { model: "glm-*" },
      inject: { file: "/etc/buckle/context/standard.md" },
    },
  ],
}
```

- **First match wins**; each `match` field is optional (subset match);
  a rule with no `match` at all is the catch-all — deliberate, loud.
- `inject` is ONE OF: `text` (inline in settings), `file` (PATH, read
  at boot), `repo_file` (fetched from the target repo over
  `git@github.com:` with the deploy key — see custody).
- Filters on model may use exact ids or trailing `*` group prefixes.
- A declared file that cannot be read is STARTUP-FATAL (a hub must
  never silently drop its own policy). `repo_file` fetch failures at
  boot: fail loud too; the rule turns the hub unhealthy rather than
  serving without its declared context.

## Injection mechanics (proven in W3081 — port, don't reinvent)

Dialect-aware system prepend, PURE (shallow-clone, never mutate):

- **anthropic dialect**: top-level `system` — string gets prepended
  (`stanza\n\nexisting`), block array gets a leading text block,
  absent system becomes the stanza.
- **openai dialect**: leading `system` message merged when present,
  else inserted at position 0.
- The stanza = the matched rule's block text. One rule, one block —
  compositing multiple blocks died with W3081 review (surprise
  concatenation); a hub that wants multiple stanzas declares multiple
  rules with distinct matches... first-match-wins forbids that, so:
  a rule's `inject` may also be `blocks: [ ... ]` for explicit order
  when one match must carry several files. (Decide at port time; the
  simple form ships first.)

## SSH/TLS key custody — "control of the private ssh key where you repack"

Once buckle modifies the body, the upstream leg is OURS. Any leg that
authenticates by SSH or TLS client key needs that private key under
buckle's control:

- Keys are PATHS in settings (0600, mounted, minted — never typed,
  never inline, never logged, never in any wire shape or error).
- `context_policy.ssh_key` is the deploy key for `repo_file` fetches
  over `git@github.com:` (read-only scope, per-org minting).
- TLS client-cert upstreams (if a provider demands mutual TLS) take
  their key the same way — the repack never downgrades the leg's
  authentication, it inherits ours.
- Fetches happen at BOOT (context is stable; per-request git traffic
  is a latency and key-exposure bug). A long-lived hub refreshes
  repo-file blocks only on reload.

## Observability

- OTel span attribute `context.rule=<id>` on every injected request;
  absent when inert. Content is NEVER in spans/logs/metrics.
- `/metrics` counter per rule id: `buckle_context_injections_total
  {rule="<id>"}` — the lane can reconcile what it rode.

## Test shape (write failing first, per the plan discipline)

1. **Unit matrix** — each dimension alone (`request`, `principal`,
   groups, `repo`, `lane`, `model` prefix, `hub`), subset semantics,
   first-match order, absent-policy inertness, unreadable-file
   startup fatality.
2. **Wire e2e (docker)** — the stub echoes the messages it received:
   assert the stanza lands upstream ONLY for matching principal/repo/
   model combos; non-matching requests arrive byte-identical (hash
   the body through the stub).
3. **Key custody** — repo_file fetch against a local git ssh fixture
   (the stub rig grows a git daemon); assert the deploy key PATH is
   honored and never appears in any log/span/error output.
4. **Honest red** — absent repo header ⇒ repo-matching rule cannot
   fire even for the same principal (the trust boundary is the
   header's provenance, not the key).

## Approaches considered

- **A (chosen): local first-match policy, client-stamped facts** —
  config-over-code, no extra hop, inert by default, key custody
  explicit.
- **B: external injector service** — rejected: policy leaves config,
  adds a hop and a failure mode between the lane and its model.
- **C: client-side-only injection in the CLI hook** — rejected: no
  central policy, no hub/model dimension the client can't see, no
  buckle-held key custody for repo fetches or client-cert legs.
