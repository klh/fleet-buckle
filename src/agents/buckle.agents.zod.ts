// agents/buckle.agents.zod.ts — the AGENT JOB contracts (lifted from
// the fleet runner's durable/contracts.ts, W2958 lineage: 2 days /
// 100+ runs of tuning distilled into these shapes). One construction
// site: every agent-plane module parses through THESE schemas, never
// hand-casts. Host-owned admission NEVER rides an agent payload.
import { z } from "zod";

/** a durable agent job's IMMUTABLE admission identity: generation is
 *  the migration point (a changed generation = a new job, never an
 *  in-place edit); the digests bind seed + sandbox policy so a spec
 *  minted against a weaker sandbox refuses at start */
export const AgentJobSpecSchema = z.strictObject({
  version: z.literal(1),
  runId: z.uuid(),
  owner: z.string().min(1).max(200),
  generation: z.number().int().positive(),
  kind: z.enum(["coding", "design", "knowledge"]),
  seedDigest: z.string().regex(/^[a-f0-9]{64}$/),
  policyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  provider: z.string().min(1).max(120),
  model: z.string().min(1).max(200),
});
export type AgentJobSpec = z.infer<typeof AgentJobSpecSchema>;

/** the on-disk identity: spec + runtime pin + host. Reopen with a
 *  different manifest = explicit migration, never silent drift */
export const AgentJobManifestSchema = z.strictObject({
  spec: AgentJobSpecSchema,
  runtime: z.literal("pi-durable@1.5.0"),
  host: z.string().min(1),
});

/** one turn into the job's brief-driven loop. requestId makes every
 *  submission idempotent — repeated ids recover the original (the
 *  crash-safety seam the review's finding #3 demanded) */
export const AgentJobInputSchema = z.strictObject({
  requestId: z.string().min(1).max(128),
  text: z.string().min(1).max(100_000),
  whenBusy: z.enum(["steer", "followUp", "reject"]).optional(),
});
export type AgentJobInput = z.infer<typeof AgentJobInputSchema>;

export type AgentJobAction = "open" | "read" | "submit" | "resume" | "abort" | "execute";

/** THE CAPABILITY BOUNDARY LIVES IN THE SEED. The supervisor may be
 *  CONTROLLED from outside in various ways (wake submissions, steer,
 *  messages, boards) — every control seam is capability-NEUTRAL: it
 *  can never grant what the seed does not declare. What the agent
 *  can access and do is determined HERE, in the digest-pinned seed
 *  payload; the job spec binds seedDigest + policyDigest, and admit
 *  recomputes both — drift refuses. Runtime capability = seed-declared
 *  ∩ runtime-offered, never runtime-added. */
export const SeedCapabilitiesSchema = z.strictObject({
  /** the model-facing tools this seed's agents may use (registered =
   *  declared ∩ offered) */
  tools: z.array(z.string().min(1)).min(1),
  /** outbound faces it may touch (github repo faces, docker exec,
   *  task spawn) — an undeclared face is unreachable, not denied */
  faces: z.array(z.string().min(1)),
  /** wake policies the seed will accept (poll/cron/event sources) */
  wakes: z.array(z.string().min(1)),
  /** budget ceilings per job (turns, spawns, wall hours) — the seed's
   *  own doom-loop ladder enforces these internally */
  budgets: z.strictObject({
    turns: z.number().int().positive(),
    spawns: z.number().int().positive(),
    wallHours: z.number().positive(),
  }),
});
export type SeedCapabilities = z.infer<typeof SeedCapabilitiesSchema>;

// — manifest shape (the W2958 contract, lifted verbatim; additive:
// the optional capabilities block is OUR human-readable summary of
// what the payload files grant — the digest is the authority) —
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const ImagePin = z.string().regex(/^[^\s@]+@sha256:[a-f0-9]{64}$/);

export const SeedManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  kind: z.literal("pi-durable-seed"),
  name: z.literal("klh/pi-durable-seed"),
  version: z.string().min(1),
  source: z.strictObject({
    revision: z.string().regex(/^[0-9a-f]{40,64}$/),
    dirty: z.boolean(),
    package: z.string().min(1),
  }),
  base_image: ImagePin,
  runtime_image: ImagePin,
  platform: z.literal("linux/amd64"),
  seed: z.strictObject({
    digest: Digest,
    files: z.number().int().positive(),
    bytes: z.number().int().positive(),
  }),
  policy: z.strictObject({
    digest: Digest,
    user: z.string().regex(/^\d+:\d+$/),
    memory_mb: z.number().int().positive(),
    cpus: z.number().positive(),
    pids_limit: z.number().int().positive(),
    work_mb: z.number().int().positive(),
    tmp_mb: z.number().int().positive(),
  }),
  deps: z.array(z.strictObject({ name: z.string().min(1), version: z.string().min(1) })),
  readiness: z.strictObject({
    command: z.array(z.string().min(1)).min(1),
    marker: z.literal("PI_DURABLE_SEED_READY"),
  }),
  sbom: z.array(
    z.strictObject({
      path: z.string().min(1),
      sha256: Digest,
      bytes: z.number().int().nonnegative(),
    }),
  ),
  built_at: z.iso.datetime({ offset: true }),
  capabilities: SeedCapabilitiesSchema.optional(),
});
export type SeedManifest = z.infer<typeof SeedManifestSchema>;

/** a staged payload file (bytes as staged — the digest input) */
export const SeedFileSchema = z.object({
  path: z.string().min(1),
  bytes: z.instanceof(Uint8Array),
});
export type SeedFile = z.output<typeof SeedFileSchema>;

/** the executor policy shape — the EXACT field order the canonical
 *  JSON digests; insertion order is the contract, never alphabetize */
export const SeedPolicySchema = z.object({
  image: z.string().min(1),
  network: z.literal("none"),
  readOnlyRoot: z.literal(true),
  capDropAll: z.literal(true),
  noNewPrivileges: z.literal(true),
  user: z.string().min(1),
  memoryMb: z.number().int().positive(),
  cpus: z.number().positive(),
  pidsLimit: z.number().int().positive(),
  workMb: z.number().int().positive(),
  tmpMb: z.number().int().positive(),
});
export type SeedPolicy = z.output<typeof SeedPolicySchema>;

/** host-owned admission and rights policy; NEVER supplied by an agent
 *  payload — the closure enforces the CURRENT lease token */
export type Authorize = (action: AgentJobAction, spec: AgentJobSpec) => Promise<void>;
