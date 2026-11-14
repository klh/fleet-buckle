// worker.github.ts — the GitHub REST client compartment: the wire
// schemas (zod — the single source of truth for what we accept) and
// the one fetch helper every GitHub effect rides. The durable rework
// keeps this verbatim; only its caller changes.
import { z } from "zod";
import { env } from "./worker.env.ts";

const GH = env.ghUrl;
const ghHeaders = {
  authorization: `Bearer ${env.token}`,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "fleet-worker",
};

export async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${GH}${path}`, { ...init, headers: ghHeaders });
  if (!r.ok) throw new Error(`gh ${path}: ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

export const Issue = z
  .object({
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    state: z.string(),
    user: z.object({ login: z.string() }),
    pull_request: z.unknown().optional(),
  })
  .passthrough();
export type Issue = z.infer<typeof Issue>;

export const Comment = z
  .object({ id: z.number(), body: z.string(), user: z.object({ login: z.string() }) })
  .passthrough();
export type Comment = z.infer<typeof Comment>;

export async function comment(number: number, body: string): Promise<void> {
  await gh(`/repos/${env.repo}/issues/${number}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
}
