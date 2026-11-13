# @fleet/buckle — the laws

One page. Every rule has a check (`tools/src/buckle.check-laws.ts`) or it is a wish.

## What buckle IS (the MITM law)

buckle is a **man-in-the-middle interface** for LLM traffic: fiddling,
exposure, key management, tracking, and context injection. Everything
forwards to the engine (litellm) untouched. The ONLY things buckle does
in-loop:

1. **Context injection** — inspect and modify messages to add context
   (a policy, for instance) per `context_policy` in settings.
2. **Key management** — keys in, per-provider keys out. Minted, never
   typed. Revocable, audited.
3. **Tracking + live overview** — who is connected, where work is taking
   place, tok/s per model/provider/buckle.
4. **Federation** — downstream peers' catalogs merged with per-hop
   access grants.

Never reimplement engine faces. Never add a "smart" feature that the
engine already has.

## Config

- **Strictly JSON5** — `*.settings.json5`. No yaml is authored by us,
  ever. (litellm's internal engine file is GENERATED at boot from our
  JSON catalog; it is an artifact, never repo config.)
- **Secrets are PATHS**, never values. `key: "/etc/buckle/keys/x.key"`.
- **Compose is wiring only** — image, ports, mounts, env PATHS. No
  providers, no peers, no limits in compose.
- **Settings compose by deep merge**: `default.settings.json5` ⊕
  `<buckle>.settings.json5`, then `safeParse` — fail loud.
- **Fetch, don't declare**: model lists are FETCHED from providers and
  peers. Settings declare providers, keys, peers, grants, limits, and
  per-model OVERRIDES only.

## Federation

- **Downstream ONLY.** `hubs` lists peers we pull from. A buckle never
  calls upstream; the graph is acyclic by construction.
- **Per-hop grants.** A downstream peer's models appear only if the
  requesting principal holds a grant on that peer, checked against that
  peer's own registry. The same law governs the HOP: a chat for a
  peer-origin model forwards verbatim to that peer (`models.use`
  re-checked THERE — the peer's registry decides, not the head's
  belief). The peer token (its `token_file`) rides the hop; the W3C
  trace continues; the serving chain rides `x-fleet-buckle-served-by`
  (each buckle prepends its label — the client sees `b1,b3`); the
  ridden hubs ride `x-fleet-buckle-hop-path`, and a hub already on it
  refuses re-entry (the loop guard — downstream-only by construction,
  guarded anyway). A 429 at the hop RELAYS with `Retry-After`; any
  other peer refusal surfaces as an `unavailable` problem NAMING the
  peer — hop authz is operator-facing, never the client's fault.
- **The federated catalog is a SET.** One row per model id, no matter
  how many hubs serve it: a machine configuring b1+b2+b3 as available
  hubs never grows duplicate or triplicate rows. Precedence is
  deterministic — own provider rows win (never hop for what we serve),
  then peers in `hubs`-declaration order. Transit copies never re-enter:
  a hub pulls only the peer's DIRECT provider rows (`origin kind=
  provider`), so a chain (b1→b2→b3) plus a direct edge (b1→b3) still
  counts b3's models once.
  A peer model outside the requesting grant's `peers` is
  indistinguishable from an unknown model (404 — no topology leak).
- Identity is **Entra-mappable, not Entra**: principals
  (`human|developer|agent|service`), groups, per-kind tiers, per-user
  overrides.

## Code

- **Types are zod-anchored.** Every data shape lives in `src/schemas/`
  as `buckle.<thing>.zod.ts`; types are `z.output`, never hand-written.
  Codecs parse in/out at every boundary; failures are a `validation`
  problem, loud.
- **Composed capability folders.** A capability is a FOLDER
  (`federation/`, `catalog/`, `proxy/`, `access/`, `live/`…) with
  single-job files `buckle.<thing>.<role>.ts`, colocated
  `<file>.test.ts` (bun test), `fixtures/`, and a thin `index.ts`
  barrel. Nothing imports past another folder's barrel.
- **One job per file.** If you cannot name the file's `<role>`, split
  it. Variants are files (`.fetch.anthropic.ts`), not `if` branches.
- **Line caps**: warn at 400 (you are composing wrong), stop at 1200,
  hard fail at 1500.
- **npm installs, Bun runs.** Exact versions, plain semver, committed
  lockfile. Dependency budget: `zod` at runtime — everything else is
  the platform.

## Tests

- Colocated unit/composition tests: `*.test.ts` next to the file, **bun
  test**.
- Everything else: **@playwright/test only**, in `/test`, driven by the
  root `playwright.config.ts` projects (`setup`, `smoke`, `e2e`,
  `federation`, `load`). The 3-buckle Docker Desktop matrix in
  `test/federation/` is the demonstrable proof of the federation laws.
- `openapi.json` is GENERATED from the wire schemas, committed, and
  diffed — consumers and tests use it; it never drifts from code.
