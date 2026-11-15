// lane.ts — the /w/ URL contract: routing AND credentials in the URL
// itself, so a client's ONE base-url string is its whole config
// (W1 lane attribution, extended). A lane's client points its
// base-URL env vars at `<root>/w/<slug>` (attribution only) or
// `<root>/w/<slug>/<token>` (BYOC: the caller's own upstream
// credential rides the path — buckle relays it as the provider-leg
// Bearer and derives a pseudonymous principal user:<sha8> for
// attribution + limits; the token is a SECRET: never logged, never
// stored, never echoed). Every LLM face answers under the prefix;
// the UPSTREAM ALWAYS SEES THE BARE PATH — the prefix is ours.
// Attribution, not authz for the slug: a slug is a label; the BYOC
// token admits exactly the user_token providers (the pipeline
// refuses it elsewhere — a token is not a principal key).
// (The old stack's NAMED BASES — /anthropic, /openai, /zai/* — were
// a mistake, not ported: any request buckle does not handle passes
// through verbatim instead.)

/** the response echo naming the lane that rode (attribution the
 *  executor can verify) */
export const LANE_ROUTE_HEADER = "x-buckle-route";

/** the slug grammar (agents.ts): starts alnum, then alnum/._- */
const LANE_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** the BYOC token grammar: same charset as a slug, but LONG — the
 *  20-char floor is what separates a credential (ghp_… 40+, Entra
 *  JWTs, fine-grained PATs 90+) from ordinary path words (v1,
 *  models, completions) so a plain /w/<lane>/v1/… path never
 *  misparses as carrying a token. */
const USER_TOKEN = /^[A-Za-z0-9._-]{20,}$/;

/** split a request path into its /w/ prefix parts:
 * `/w/<slug>/rest`            → { lane, path: "/rest", userToken: null }
 * `/w/<slug>/<token>/rest`    → { lane, path: "/rest", userToken: "<token>" }
 * (`/w/<slug>` alone → path "/"); any other path → { lane: "",
 * userToken: null, path: unchanged } */
export function lanePrefixOf(pathname: string): {
  lane: string;
  path: string;
  userToken: string | null;
} {
  const marker = pathname.indexOf("/w/");
  if (marker !== 0) return { lane: "", path: pathname, userToken: null };
  const rest = pathname.slice(3);
  const slash = rest.indexOf("/");
  const slug = slash === -1 ? rest : rest.slice(0, slash);
  if (!LANE_SLUG.test(slug)) return { lane: "", path: pathname, userToken: null };
  if (slash === -1) return { lane: slug, path: "/", userToken: null };
  const inner = rest.slice(slash + 1);
  const nextSlash = inner.indexOf("/");
  const second = nextSlash === -1 ? inner : inner.slice(0, nextSlash);
  const tail = nextSlash === -1 ? "/" : inner.slice(nextSlash);
  return USER_TOKEN.test(second)
    ? { lane: slug, path: tail, userToken: second }
    : { lane: slug, path: `/${inner}`, userToken: null };
}

/** the pseudonymous principal a BYOC token derives — stable per dev
 * (same token ⇒ same id), never reversible from the id alone */
export function userIdOf(token: string): string {
  return `user:${new Bun.CryptoHasher("sha256").update(token).digest("hex").slice(0, 8)}`;
}
