// agents/buckle.agents.writer.ts — the host writer lock (lifted from
// durable/host-writer.ts): a transaction on a separate private SQLite
// file holds the OS lock for this writer; the OS releases it on crash
// without PID cleanup. One durable-job writer per host, ever.
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { errnoOr, attempt } from "../fault.ts";
import { existingEntry, privateDirectory } from "./buckle.agents.paths.ts";

/** POSIX privacy: a regular file, no foreign hardlinks, our uid,
 *  nothing for group/other — each leg named, none silent */
const assertPrivate = async (path: string, suffix: string): Promise<void> => {
  const info = suffix === "" ? await lstat(path) : await existingEntry(path + suffix);
  if (info === null) return;
  const notRegularFile = !info.isFile();
  const foreignHardlink = info.nlink !== 1;
  const foreignOwner = info.uid !== process.getuid?.();
  const groupOrOtherBits = (info.mode & 0o077) !== 0;
  if (notRegularFile || foreignHardlink || foreignOwner || groupOrOtherBits)
    throw new Error("agents: writer file must be private to its POSIX owner");
};

export async function acquireHostWriter(directory: string): Promise<() => Promise<void>> {
  await privateDirectory(directory);
  const path = join(await realpath(directory), "writer.sqlite");
  if (!(await existingEntry(path))) {
    // EEXIST = another writer won the create race — fine
    await errnoOr(async () => {
      (await open(path, "wx", 0o600)).close();
    }, "EEXIST");
  }
  for (const suffix of ["", "-wal", "-shm", "-journal"]) await assertPrivate(path, suffix);
  const db = new DatabaseSync(path);
  attempt(
    () => db.exec("BEGIN IMMEDIATE"),
    (fault) => {
      db.close();
      throw new Error("agents: durable writer unavailable", { cause: fault });
    },
  );
  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    db.close();
  };
}
