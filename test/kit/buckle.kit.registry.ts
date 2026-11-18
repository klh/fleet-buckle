// buckle.kit.registry.ts — the registry-pin env contract for the graph:
// the PUBLISHED worker image is named by BUCKLE_WORKER_IMAGE and must be
// pinned (digest or explicit non-latest tag). Fixtures are isolated:
// a live repository slug is refused.
const PINNED = /^[^\s@:]+(?::\d+)?(?:\/[^\s@:]+)+(?::(?!latest$)[\w][\w.-]*|@sha256:[0-9a-f]{64})$/;
const LIVE_REPO = /^icomdev\//i;

export function workerImage(env: NodeJS.ProcessEnv = process.env): string {
  const image = env["BUCKLE_WORKER_IMAGE"];
  if (image === undefined || !PINNED.test(image))
    throw new Error(
      "BUCKLE_WORKER_IMAGE must be a pinned published ref (registry/name:tag|@sha256:…, never :latest)",
    );
  return image;
}

export function assertIsolatedFixtures(env: NodeJS.ProcessEnv = process.env): void {
  const repo = env["WORKER_REPO"];
  if (repo !== undefined && LIVE_REPO.test(repo))
    throw new Error(`WORKER_REPO=${repo} is a live repository; graph fixtures must be isolated`);
}

/** bounded readiness: poll a total probe until true or the deadline. */
export async function ready(
  what: string,
  probe: () => Promise<boolean>,
  timeoutMs = 120_000,
  stepMs = 1_000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await probe().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`readiness timeout after ${timeoutMs}ms: ${what}`);
}
