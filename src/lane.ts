// lane.ts — the /w/<slug> LANE PREFIX: executor attribution from the
// URL itself (W1 lane attribution, ported). A lane's client points
// its base-URL env vars at `<root>/w/<slug>` (agents.ts laneEnv in
// the old stack); every LLM face answers under the prefix, the slug
// feeds attribution (the judge's lane fact + the x-buckle-route
// response echo), and the UPSTREAM ALWAYS SEES THE BARE PATH — the
// prefix is ours, never the engine's. Attribution, not authz: the
// principal key remains the only authority; a slug is a label any
// authenticated caller may carry. (The old stack's NAMED BASES
// — /anthropic, /openai, /zai/* — were a mistake, not ported: any
// request buckle does not handle passes through verbatim instead.)

/** the response echo naming the lane that rode (attribution the
 *  executor can verify) */
export const LANE_ROUTE_HEADER = "x-buckle-route";

/** the slug grammar (agents.ts): starts alnum, then alnum/._- */
const LANE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** split a request path into its lane prefix parts: path
 *  `/w/<slug>/rest` → { lane: "<slug>", path: "/rest" } (the
 *  stripped remainder; "/w/<slug>" alone → "/"); any other path →
 *  { lane: "", path: unchanged } */
export function lanePrefixOf(pathname: string): { lane: string; path: string } {
  const marker = pathname.indexOf("/w/");
  if (marker !== 0) return { lane: "", path: pathname };
  const rest = pathname.slice(3);
  const slash = rest.indexOf("/");
  const slug = slash === -1 ? rest : rest.slice(0, slash);
  const inner = slash === -1 ? "/" : rest.slice(slash);
  return LANE_SLUG.test(slug) ? { lane: slug, path: inner } : { lane: "", path: pathname };
}
