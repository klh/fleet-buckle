// gui.oidc.ts — the GENERIC OIDC device-code front door: discovery
// from <issuer>/.well-known/openid-configuration (cached), device
// authorization + poll, id_token RS256 verify against the IdP JWKS
// via node:crypto — NO new deps. Entra is just ONE issuer string:
// any compliant IdP works, and the hermetic e2e rides a stub.
import { createPublicKey, createVerify } from "node:crypto";

/** the discovery slice the front door needs (device flow + verify) */
export type Discovery = {
  issuer: string;
  device_authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const discoveryCache = new Map<string, { doc: Discovery; at: number }>();

export async function discover(issuer: string): Promise<Discovery> {
  const hit = discoveryCache.get(issuer);
  if (hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) return hit.doc;
  const res = await fetch(`${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`discovery failed: ${res.status}`);
  const doc = (await res.json()) as Partial<Discovery>;
  if (
    doc.device_authorization_endpoint === undefined ||
    doc.token_endpoint === undefined ||
    doc.jwks_uri === undefined
  )
    throw new Error("discovery doc lacks device/token/jwks endpoints");
  const full: Discovery = {
    issuer,
    device_authorization_endpoint: doc.device_authorization_endpoint,
    token_endpoint: doc.token_endpoint,
    jwks_uri: doc.jwks_uri,
  };
  discoveryCache.set(issuer, { doc: full, at: Date.now() });
  return full;
}

/** the device authorization grant the operator sees (the device_code
 *  itself NEVER leaves the server — the handle maps to it) */
export type DeviceLogin = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
};

export async function startDeviceLogin(issuer: string, clientId: string): Promise<DeviceLogin> {
  const doc = await discover(issuer);
  const res = await fetch(doc.device_authorization_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: "openid profile" }),
  });
  if (!res.ok) throw new Error(`device authorization failed: ${res.status}`);
  const login = (await res.json()) as Partial<DeviceLogin>;
  if (login.device_code === undefined || login.user_code === undefined || login.verification_uri === undefined)
    throw new Error("device authorization response incomplete");
  return {
    device_code: login.device_code,
    user_code: login.user_code,
    verification_uri: login.verification_uri,
    ...(login.verification_uri_complete !== undefined
      ? { verification_uri_complete: login.verification_uri_complete }
      : {}),
    expires_in: login.expires_in ?? 900,
    ...(login.interval !== undefined ? { interval: login.interval } : {}),
  };
}

/** one token poll — the states the GUI relays to the console */
export type TokenPoll =
  | { state: "pending" }
  | { state: "slow_down" }
  | { state: "done"; id_token: string }
  | { state: "expired" }
  | { state: "failed"; error: string };

export async function pollDeviceToken(
  issuer: string,
  clientId: string,
  deviceCode: string,
): Promise<TokenPoll> {
  const doc = await discover(issuer);
  const res = await fetch(doc.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: clientId,
      device_code: deviceCode,
    }),
  });
  const body = (await res.json().catch(() => null)) as { error?: string; id_token?: string } | null;
  if (res.ok && body?.id_token !== undefined) return { state: "done", id_token: body.id_token };
  const error = body?.error ?? `http_${res.status}`;
  if (error === "authorization_pending") return { state: "pending" };
  if (error === "slow_down") return { state: "slow_down" };
  if (error === "expired_token" || error === "authorization_declined") return { state: "expired" };
  return { state: "failed", error };
}

type Jwk = { kid?: string; kty?: string; n?: string; e?: string };
const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();

async function jwksOf(uri: string, force: boolean): Promise<Jwk[]> {
  const hit = jwksCache.get(uri);
  if (!force && hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) return hit.keys;
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  const doc = (await res.json()) as { keys?: Jwk[] };
  const keys = doc.keys ?? [];
  jwksCache.set(uri, { keys, at: Date.now() });
  return keys;
}

/** the claims the session rides — identity AT the front door only */
export type SessionClaims = { sub: string; name?: string; email?: string };

function decode(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

/** verify an id_token the hard way: RS256 signature against the
 *  issuer's JWKS (kid match, rotation refetch), then iss / aud /
 *  exp / sub. Throws on ANY miss — the caller refuses the session. */
export async function verifyIdToken(
  issuer: string,
  audience: string,
  idToken: string,
): Promise<SessionClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("id_token: not a JWS");
  const [headSeg, paySeg, sigSeg] = parts as [string, string, string];
  const header = decode(headSeg) as { alg?: string; kid?: string };
  if (header.alg !== "RS256") throw new Error(`id_token: alg ${header.alg ?? "?"}, want RS256`);
  const payload = decode(paySeg) as {
    iss?: string;
    aud?: string | string[];
    exp?: number;
    sub?: string;
    name?: string;
    email?: string;
    preferred_username?: string;
  };
  const doc = await discover(issuer);
  const byKid = (keys: Jwk[]): Jwk | undefined =>
    keys.find((k) => k.kid === header.kid && k.n !== undefined && k.e !== undefined);
  let key = byKid(await jwksOf(doc.jwks_uri, false));
  if (key === undefined) key = byKid(await jwksOf(doc.jwks_uri, true)); // rotation: refetch once
  if (key === undefined) throw new Error("id_token: kid absent from JWKS");
  const ok = createVerify("RSA-SHA256")
    .update(`${headSeg}.${paySeg}`)
    .verify(createPublicKey({ key: key as never, format: "jwk" }), Buffer.from(sigSeg, "base64url"));
  if (!ok) throw new Error("id_token: bad signature");
  if (payload.iss !== issuer) throw new Error("id_token: issuer mismatch");
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(audience)) throw new Error("id_token: audience mismatch");
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now() - 30_000)
    throw new Error("id_token: expired");
  if (typeof payload.sub !== "string" || payload.sub === "") throw new Error("id_token: no sub");
  const claims: SessionClaims = { sub: payload.sub };
  const name = payload.name ?? payload.preferred_username ?? payload.email;
  if (name !== undefined) claims.name = name;
  if (payload.email !== undefined) claims.email = payload.email;
  return claims;
}
