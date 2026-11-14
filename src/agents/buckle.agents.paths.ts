// agents/buckle.agents.paths.ts — private POSIX job storage (lifted
// from the fleet runner's durable/private-paths.ts). An existing user
// path is VALIDATED, never chmod'd; symlinks refuse; the atomic
// 0600 writer lives here (one construction site for the agents tree).
import { lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { errnoOr } from "../fault.ts";

export async function existingEntry(path: string) {
  return await errnoOr(() => lstat(path), "ENOENT");
}

/** 0700 directory private to its POSIX owner — symlink or file refuses */
export async function privateDirectory(path: string): Promise<void> {
  let info = await existingEntry(path);
  if (!info) {
    // EEXIST = another writer created it first — race-won, continue
    await errnoOr(() => mkdir(path, { mode: 0o700 }), "EEXIST");
    info = await lstat(path);
  }
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error("agents: job directory must not be a symlink or file");
  if (!process.getuid || info.uid !== process.getuid() || (info.mode & 0o077) !== 0)
    throw new Error("agents: job directory must be private to its POSIX owner");
}

/** atomic 0600 write: tmp in the SAME directory (one filesystem),
 *  rename is the commit — a crash never leaves a torn file */
export async function atomicWrite0600(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, { mode: 0o600 });
  await rename(tmp, path);
}
