// metrics/buckle.metrics.window.ts — the shared MEM-CACHE window the
// collectors ride: one TTL, single-flight (concurrent readers share
// the in-flight pull), strictly-fresh semantics (ttl 0 = every call
// pulls — same-ms calls never serve cached). The pull never rejects;
// the loader owns its fault folding.
export function createWindowCache<T>(ttlMs: number, load: () => Promise<T>) {
  let cached: { at: number; value: T } | null = null;
  let pulling: Promise<T> | null = null;
  return {
    async get(): Promise<T> {
      if (cached !== null && Date.now() - cached.at < ttlMs) return cached.value;
      if (pulling === null)
        pulling = load().then((value) => {
          cached = { at: Date.now(), value };
          return value;
        });
      const p = pulling;
      void p.then(() => {
        if (pulling === p) pulling = null;
      });
      return p;
    },
  };
}
