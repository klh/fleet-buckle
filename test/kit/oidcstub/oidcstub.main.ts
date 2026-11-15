// oidcstub.main.ts — the hermetic OIDC IdP for the e2e rig: ONE RSA
// keypair at boot (RS256 via node:crypto), discovery + device
// authorization + token + JWKS. Approval rides the /_approve test
// face (the spec flips it — no browser in the rig). The issuer is
// whatever origin the request arrives on (inside the compose net:
// http://oidc:8080 — exactly what the GUI is configured with).
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { z } from "zod";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
jwk["kid"] = "stub-kid";
jwk["alg"] = "RS256";
jwk["use"] = "sig";

const _DeviceSchema = z.object({
  deviceCode: z.string(),
  clientId: z.string(),
  approved: z.boolean(),
});
type Device = z.output<typeof _DeviceSchema>;
/** keyed by USER_CODE — the public correlation a human (or the spec)
 *  holds; the device_code grant secret never leaves the IdP/GUI */
const devices = new Map<string, Device>();

function byDeviceCode(code: string): Device | undefined {
  for (const d of devices.values()) if (d.deviceCode === code) return d;
  return undefined;
}

function idToken(base: string, clientId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const signingInput = `${enc({ alg: "RS256", kid: jwk["kid"], typ: "JWT" })}.${enc({
    iss: base,
    aud: clientId,
    sub: "stub-dev-1",
    name: "Stub Dev",
    preferred_username: "stub@stub.test",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(signingInput).sign(privateKey).toString("base64url");
  return `${signingInput}.${sig}`;
}

Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env["PORT"] ?? 8080),
  async fetch(req) {
    const url = new URL(req.url);
    const base = url.origin;
    if (url.pathname === "/.well-known/openid-configuration")
      return Response.json({
        issuer: base,
        device_authorization_endpoint: `${base}/devicecode`,
        token_endpoint: `${base}/token`,
        jwks_uri: `${base}/jwks.json`,
      });
    if (url.pathname === "/devicecode" && req.method === "POST") {
      const form = new URLSearchParams(await req.text());
      const deviceCode = randomUUID();
      devices.set("STUB-2468", { deviceCode, clientId: form.get("client_id") ?? "", approved: false });
      return Response.json({
        device_code: deviceCode,
        user_code: "STUB-2468",
        verification_uri: `${base}/activate`,
        expires_in: 900,
        interval: 1,
      });
    }
    if (url.pathname === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await req.text());
      if (form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:device_code")
        return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
      const device = byDeviceCode(form.get("device_code") ?? "");
      if (device === undefined) return Response.json({ error: "expired_token" }, { status: 400 });
      if (!device.approved) return Response.json({ error: "authorization_pending" }, { status: 400 });
      const client = form.get("client_id") ?? device.clientId;
      for (const [code, d] of devices) if (d === device) devices.delete(code); // one grant, one token
      return Response.json({
        access_token: "stub-access",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: idToken(base, client),
      });
    }
    if (url.pathname === "/jwks.json") return Response.json({ keys: [jwk] });
    if (url.pathname === "/_approve" && req.method === "POST") {
      const device = devices.get(url.searchParams.get("user_code") ?? "");
      if (device === undefined) return new Response("no such login", { status: 404 });
      device.approved = true;
      return new Response("approved");
    }
    return new Response("not found", { status: 404 });
  },
});
console.log("oidc stub on :", Number(process.env["PORT"] ?? 8080));
