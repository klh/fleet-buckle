// gui.session.ts — the HMAC session cookie: stateless (the sealed
// claims ARE the session), minted only from a VERIFIED id_token,
// sealed with the 0600 session key file (read per call — key
// rotation never restarts the GUI). Missing key file = no sessions:
// fail closed.
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const COOKIE = "buckle_session";
const KEY_FILE = process.env["SESSION_KEY_FILE"] ?? "";
const TTL_S = Number(process.env["SESSION_TTL_S"] ?? 12 * 60 * 60);

export type Session = { sub: string; name?: string; iat: number; exp: number };

function secret(): Buffer | null {
  if (KEY_FILE === "") return null;
  try {
    const value = readFileSync(KEY_FILE, "utf8").trim();
    return value === "" ? null : Buffer.from(value, "utf8");
  } catch {
    return null;
  }
}

function secure(): string {
  return (process.env["PUBLIC_URL"] ?? "").startsWith("https://") ? "; Secure" : "";
}

function seal(payload: Session, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** mint the Set-Cookie header value for a verified principal */
export function mintSessionCookie(sub: string, name?: string): string | null {
  const key = secret();
  if (key === null) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload: Session = { sub, iat: now, exp: now + TTL_S, ...(name !== undefined ? { name } : {}) };
  return `${COOKIE}=${seal(payload, key)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_S}${secure()}`;
}

/** the logout cookie: expire immediately */
export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`;
}

/** read + verify a session from a Cookie header — ANY miss is null */
export function readSession(header: string | null): Session | null {
  if (header === null) return null;
  const key = secret();
  if (key === null) return null;
  const row = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (row === undefined) return null;
  const [body, mac] = row.slice(COOKIE.length + 1).split(".") as [string | undefined, string | undefined];
  if (body === undefined || mac === undefined) return null;
  const want = createHmac("sha256", key).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Session;
  if (typeof session.exp !== "number" || session.exp * 1000 < Date.now()) return null;
  if (typeof session.sub !== "string" || session.sub === "") return null;
  return session;
}
