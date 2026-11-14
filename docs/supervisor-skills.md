# Supervisor skills and session handoff

Status: target workflow. The catalog, promotion flow, and remote runner
controls described here are design requirements, not deployed UI.

A **supervisor skill** is a reusable, versioned definition of what a
durable supervisor does. It contains a brief, decision rules for doing
work or spawning children, wake types, required tools, review points,
and completion criteria. An **assignment** supplies a repository or
other resource, hub, limits, and permissions for one job. A **seed** is
the pinned runtime and sandbox payload that executes allowed tools.
Skill text and imported chat context grant no authority by themselves.

## Hand off an interactive session

1. In a normal session routed through Buckle, choose **Keep working
   remotely**. The client previews the context it will export;
   Buckle alone cannot reconstruct local tool state or a complete chat.
2. Choose a premade supervisor skill from the catalog, fork a version
   of one, or choose **Create a supervisor skill**. The first test uses
   the general GitHub bugfixer and feature implementer skill with an
   `icomdev/calculon` assignment.
3. Answer the skill's unbound questions: goal, resources, wake schedule
   or event source, permitted effects, approval rules, hub, model and
   spend limits, and stop conditions. Show the resolved brief and
   effective policy before activation.
4. Explicitly enable the job. The host validates and records the
   checkpoint digest, skill content digest, assignment policy, owner,
   hub, and seed/backend digests as one idempotent handoff, then starts
   a new durable job generation. The remote status view exposes history,
   budget use,
   and pause, resume, and stop controls.

## Create or adapt a supervisor skill

1. Write a concise role and success criterion. Separate reusable
   behavior from assignment values such as repository, credentials,
   hub, and budget.
2. Specify wake sources, what the supervisor does itself, when it may
   spawn children (a context-preserving clone or a brief-only new
   worker — the default stays single-lane), required tools, review
   gates, and stop conditions.
   Name every effect that requires approval. Code-producing skills
   ride the seed's mechanical quality gates: qlty checks every write
   and the full diff after an implementing run (biome for code,
   prettier for markdown), and the skill's first code step reads the
   repo's `.qlty/qlty.toml` and biome rule set before the first
   write. The gates are not optional review points — they are how
   output stays consistent and mechanically secured.
3. Declare the capabilities the skill needs. Check them against the
   available seed's declared ceiling and the proposed host policy.
   If the runtime lacks a required capability, request a separately
   reviewed seed build; do not extend a running job by editing a skill.
4. Version the skill, preview its resolved brief and effective
   capabilities with a sample assignment, then test one bounded run
   before offering it in the catalog. Changes in authority create a
   new job generation.

The [target architecture](target-architecture.md) defines the host,
model, sandbox, and approval boundaries. The Docker executor is the
first backend; the handoff and skill contracts must work with a later
Firecracker-style microVM backend too.
