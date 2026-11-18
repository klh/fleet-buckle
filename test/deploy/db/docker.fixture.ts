// Minimal Docker Engine API client over /var/run/docker.sock (no docker CLI on the seat).
import http from "node:http";

export function api(method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      { socketPath: "/var/run/docker.sock", method, path, headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/** docker multiplexed stream -> plain text */
function demux(buf: Buffer): string {
  let out = "";
  let i = 0;
  while (i + 8 <= buf.length) {
    const n = buf.readUInt32BE(i + 4);
    out += buf.subarray(i + 8, i + 8 + n).toString("utf8");
    i += 8 + n;
  }
  return out;
}

export async function run(name: string, config: Record<string, unknown>): Promise<void> {
  await api("DELETE", `/containers/${name}?force=true`);
  const c = await api("POST", `/containers/create?name=${name}`, config);
  if (c.status !== 201) throw new Error(`create ${name}: ${c.text}`);
  const s = await api("POST", `/containers/${name}/start`);
  if (s.status !== 204) throw new Error(`start ${name}: ${s.text}`);
}

export const rm = (name: string) => api("DELETE", `/containers/${name}?force=true&v=true`);
export const stop = (name: string) => api("POST", `/containers/${name}/stop?t=2`);
export const start = (name: string) => api("POST", `/containers/${name}/start`);
export const netCreate = (name: string) => api("POST", "/networks/create", { Name: name });
export const netRm = (name: string) => api("DELETE", `/networks/${name}`);

export async function exec(name: string, cmd: string[], stdin?: string): Promise<{ code: number; out: string }> {
  const created = await api("POST", `/containers/${name}/exec`, { Cmd: cmd, AttachStdout: true, AttachStderr: true, AttachStdin: stdin !== undefined });
  const id = (JSON.parse(created.text) as { Id: string }).Id;
  const out = await new Promise<string>((resolve, reject) => {
    const req = http.request(
      { socketPath: "/var/run/docker.sock", method: "POST", path: `/exec/${id}/start`, headers: { "content-type": "application/json", connection: "Upgrade", upgrade: "tcp" } },
      (res) => { const ch: Buffer[] = []; res.on("data", (c: Buffer) => ch.push(c)); res.on("end", () => resolve(demux(Buffer.concat(ch)))); },
    );
    req.on("upgrade", (_res, socket) => {
      const ch: Buffer[] = [];
      socket.on("data", (c: Buffer) => ch.push(c));
      socket.on("end", () => resolve(demux(Buffer.concat(ch))));
      if (stdin !== undefined) socket.end(stdin);
    });
    req.on("error", reject);
    req.end(JSON.stringify({ Detach: false, Tty: false }));
  });
  const info = JSON.parse((await api("GET", `/exec/${id}/json`)).text) as { ExitCode: number };
  return { code: info.ExitCode, out };
}

export async function waitFor(fn: () => Promise<boolean>, ms: number, label: string): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timeout: ${label}`);
}
