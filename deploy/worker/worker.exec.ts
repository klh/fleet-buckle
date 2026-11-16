// worker.exec.ts — the microworker compartment: bounded containers
// over the mounted docker socket (the sandbox-exec seam). The seed
// lift makes this the FIRST place a seed image replaces the ad-hoc
// python/node images — same interface, pinned digests.
import { z } from "zod";
import { env } from "./worker.env.ts";

// the docker engine version we SPEAK — engines enforce a floor
// (the azure VMSS rejects <1.44); 1.44 is safe across modern hosts
// and the hermetic rig alike.
const DOCKER_API = "v1.44";

const dockerCall = async (
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<Response> =>
  await fetch(`http://docker/${DOCKER_API}${path}`, {
    method: init.method ?? "GET",
    unix: env.dockerSock,
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body,
  });

const createContainer = async (image: string, cmd: string[]): Promise<string> => {
  const r = await dockerCall("/containers/create", {
    method: "POST",
    body: JSON.stringify({ Image: image, Cmd: cmd, HostConfig: { AutoRemove: false } }),
  });
  if (!r.ok) throw new Error(`docker create: ${r.status} ${await r.text()}`);
  return z.object({ Id: z.string() }).parse(await r.json()).Id;
};

const awaitExit = async (id: string, timeoutMs = 120_000): Promise<number> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await dockerCall(`/containers/${id}/json`);
    const { State: st } = z
      .object({ State: z.object({ Running: z.boolean(), ExitCode: z.number() }) })
      .parse(await r.json());
    if (!st.Running) return st.ExitCode;
    if (Date.now() > deadline) throw new Error("microworker timeout");
    await Bun.sleep(250);
  }
};

/** run one small container and return its logs — the microworker that
 *  performs a bounded piece of work (a compile check, a syntax pass) */
async function microworker(image: string, cmd: string[]): Promise<string> {
  const id = await createContainer(image, cmd);
  const start = await dockerCall(`/containers/${id}/start`, { method: "POST" });
  if (!start.ok) throw new Error(`docker start: ${start.status}`);
  const exitCode = await awaitExit(id);
  const logs = await dockerCall(`/containers/${id}/logs?stdout=1&stderr=1`);
  const out = await logs.text();
  await dockerCall(`/containers/${id}?force=1`, { method: "DELETE" });
  if (exitCode !== 0) throw new Error(`microworker ${image} exit ${exitCode}: ${out}`);
  return out;
}

/** syntax-check one changed file with a fitting microworker image */
export async function checkFile(path: string, content: string): Promise<void> {
  const b64 = Buffer.from(content, "utf8").toString("base64");
  if (path.endsWith(".py")) {
    await microworker("python:3.12-slim", [
      "python",
      "-c",
      `import pathlib,py_compile,tempfile; p=tempfile.mktemp(suffix=".py"); pathlib.Path(p).write_bytes(__import__("base64").b64decode("${b64}")); py_compile.compile(p, doraise=True)`,
    ]);
  } else if (path.endsWith(".ts") || path.endsWith(".js") || path.endsWith(".json")) {
    await microworker("node:22-slim", [
      "node",
      "-e",
      `const b=Buffer.from("${b64}","base64"); ${path.endsWith(".json") ? `JSON.parse(b.toString())` : `new Function(b.toString());`}`,
    ]);
  }
  // other file kinds ride unchecked (docs, css — the PR review owns them)
}
