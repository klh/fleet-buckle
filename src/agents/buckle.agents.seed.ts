// agents/buckle.agents.seed.ts — the seed digest + manifest library
// (lifted verbatim from pi-durable-workers/src/seed-manifest.ts, the
// W2958 reproducible-build core). ONE construction site shared by the
// seed build (deploy/seed/build.ts), admit, and the executor. The two
// canonical algorithms are byte-compatible with the runner host:
//   - canonicalSeedDigest — sha256 over canonical JSON of path-sorted
//     {path, digest} pairs (no order noise, no newline aliasing); the
//     host recomputes this at admit and refuses drift.
//   - canonicalPolicyDigest — sha256 over the canonical limits JSON in
//     the executor's EXACT key order (insertion order is the contract;
//     do not alphabetize) — start refuses a spec stamped with a
//     different digest.
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWrite0600 } from "./buckle.agents.paths.ts";
import {
  SeedManifestSchema,
  type SeedManifest,
  type SeedFile,
  type SeedPolicy,
} from "./buckle.agents.zod.ts";

/** sha256 hex — the same primitive the runner host's digestOf uses. */
export const digestOf = (input: string | Uint8Array): string =>
  createHash("sha256").update(input).digest("hex");

// SeedFile/SeedPolicy derive from the zod home (values in files,
// shape in schema) — re-exported for the build/stage callers
export type { SeedFile, SeedPolicy };

/** Canonical seed digest over a payload file set (payload-relative paths). */
export const canonicalSeedDigest = (files: readonly SeedFile[]): string => {
  const entries = files
    .map((f) => ({ path: f.path, digest: digestOf(f.bytes) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return digestOf(JSON.stringify(entries));
};

/** Canonical JSON in the executor's key order — insertion order is the
 *  contract; do not alphabetize. */
export const canonicalPolicyJson = (policy: SeedPolicy): string =>
  JSON.stringify({
    image: policy.image,
    network: policy.network,
    readOnlyRoot: policy.readOnlyRoot,
    capDropAll: policy.capDropAll,
    noNewPrivileges: policy.noNewPrivileges,
    user: policy.user,
    memoryMb: policy.memoryMb,
    cpus: policy.cpus,
    pidsLimit: policy.pidsLimit,
    workMb: policy.workMb,
    tmpMb: policy.tmpMb,
  });

export const canonicalPolicyDigest = (policy: SeedPolicy): string =>
  digestOf(canonicalPolicyJson(policy));

// — manifest parse/write (schema law: named schema, safeParse at the face) —

/** The ONE parse face for seed/manifest.json content. */
export const parseSeedManifest = (raw: unknown) => SeedManifestSchema.safeParse(raw);

/** Atomic 0600 manifest write — the manifest binds identity digests and
 *  must not be world-readable mid-write. Rides the ONE atomic writer
 *  (agents.paths owns the tmp+rename construction). */
export const writeSeedManifest = async (dest: string, manifest: SeedManifest): Promise<void> => {
  await mkdir(dirname(dest), { recursive: true });
  await atomicWrite0600(dest, `${JSON.stringify(manifest, null, "\t")}\n`);
};

export type { SeedManifest };
