// worker.flow.ts — the ISSUE PHASE MACHINE (policy, not engine):
// seen → clarified → accepted → delivered, one sweep at a time. This
// module is the durable worker's actual brain — the rework keeps it
// VERBATIM; only its driver (the loop, then a durable task) changes.
import { z } from "zod";
import { env } from "./worker.env.ts";
import { gh, Issue, Comment, comment } from "./worker.github.ts";
import type { State, PhaseRow } from "./worker.state.ts";
import { ask } from "./worker.model.ts";
import { checkFile } from "./worker.exec.ts";

const ACCEPT_RE = /\b(accepted?|implement(ed)?|go ahead|ship it|do it|approved?|build it)\b/i;

const Classification = z.object({ kind: z.enum(["feature", "bug", "other"]) });
const Clarification = z.object({
  questions: z.array(z.string()).min(1).max(4),
});
const Plan = z.object({
  summary: z.string(),
  files: z
    .array(z.object({ path: z.string(), content: z.string() }))
    .min(1)
    .max(5),
});

/** an issue the sweep OWNS: a real issue (not a PR), open, and
 *  titled under the scope guard prefix */
const isOwned = (issue: Issue): boolean =>
  issue.pull_request === undefined &&
  (env.issuePrefix === "" || issue.title.startsWith(env.issuePrefix));

/** open, prefixed, non-PR issues — the sweep's whole frontier */
const openIssues = async (): Promise<Issue[]> => {
  const raw = await gh<unknown[]>(`/repos/${env.repo}/issues?state=open&sort=updated&per_page=20`);
  const out: Issue[] = [];
  for (const i of raw) {
    const p = Issue.safeParse(i);
    if (p.success && isOwned(p.data)) out.push(p.data);
  }
  return out;
};

const isHuman = (c: Comment): boolean =>
  c.user.login !== "fleet-worker[bot]" && !c.user.login.includes("[bot]");

/** all comments, oldest first, and the HUMAN ones since our last
 *  visit — the only words that can move a phase */
const freshComments = async (
  row: PhaseRow,
  n: number,
): Promise<{ comments: Comment[]; fresh: Comment[] }> => {
  const comments = (await gh<unknown[]>(`/repos/${env.repo}/issues/${n}/comments?per_page=50`))
    .map((c) => Comment.parse(c))
    .sort((a, b) => a.id - b.id);
  const fresh = comments.filter((c) => c.id > row.lastComment && isHuman(c));
  row.lastComment = comments.at(-1)?.id ?? row.lastComment;
  return { comments, fresh };
};

/** SEEN: classify, then either bow out (other) or ask the pin-down
 *  questions (feature/bug) — one model pass each */
const phaseSeen = async (issue: Issue, row: PhaseRow): Promise<void> => {
  const subject = `title: ${issue.title}\nbody: ${issue.body ?? ""}`;
  const { kind } = await ask(
    Classification,
    "Classify this GitHub issue for the calculon repo (a natural-language notepad calculator with a static demo site).",
    subject,
  );
  if (kind === "other") {
    await comment(
      issue.number,
      "Noted — this doesn't look like a feature or a bug. I'll leave it to the humans. 🫡",
    );
    row.phase = "delivered";
    return;
  }
  const { questions } = await ask(
    Clarification,
    "The writer filed this. Ask the 1-4 pin-down questions you need before implementing it (each one concrete and answerable in a line).",
    subject,
  );
  await comment(
    issue.number,
    `Thanks! A few things to pin down before I build it:\n\n${questions.map((q) => `- ${q}`).join("\n")}\n\nReply with the answers and write **accepted** (or "implement"/"go ahead") when you're happy — then I'll do the work and raise a PR connected to this issue.`,
  );
  row.phase = "clarified";
};

/** the existing-file sha on a branch ("" when the file is new) —
 *  an overwrite needs it, a create must not carry it */
const contentsSha = async (path: string, branch: string): Promise<string> => {
  const existing = await gh<unknown>(`/repos/${env.repo}/contents/${path}?ref=${branch}`).catch(
    () => null,
  );
  if (
    typeof existing === "object" &&
    existing !== null &&
    "sha" in existing &&
    typeof existing["sha"] === "string"
  )
    return existing["sha"];
  return "";
};

const landFile = async (
  n: number,
  branch: string,
  summary: string,
  f: { path: string; content: string },
): Promise<void> => {
  const sha = await contentsSha(f.path, branch);
  await gh(`/repos/${env.repo}/contents/${f.path}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: `agent: ${summary} (#${n})`,
      branch,
      content: Buffer.from(f.content, "utf8").toString("base64"),
      ...(sha ? { sha } : {}),
    }),
  });
};

const cutBranch = async (branch: string): Promise<void> => {
  const mainRef = await gh<{ object: { sha: string } }>(`/repos/${env.repo}/git/ref/heads/main`);
  await gh(`/repos/${env.repo}/git/refs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainRef.object.sha }),
  });
};

const raisePull = async (n: number, branch: string, summary: string): Promise<string> => {
  const pr = await gh<{ html_url: string }>(`/repos/${env.repo}/pulls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `${summary} (#${n})`,
      head: branch,
      base: "main",
      body: `Closes #${n}\n\nImplemented by the durable worker (lane \`${env.lane}\`, microworkers ran the syntax checks). Review and merge — the GitHub Pages site updates from \`docs/\` on merge.`,
    }),
  });
  return pr.html_url;
};

/** ACCEPTED: plan the diff, syntax-check every file with
 *  microworkers, cut the branch, land the files, raise the PR, post
 *  the done-comment */
const phaseDeliver = async (issue: Issue, comments: Comment[], row: PhaseRow): Promise<void> => {
  const thread = comments.map((c) => `${c.user.login}: ${c.body}`).join("\n");
  const tree = await gh<{ tree: { path: string }[] }>(
    `/repos/${env.repo}/git/trees/main?recursive=1`,
  );
  const { summary, files } = await ask(
    Plan,
    `You are implementing a GitHub issue on the calculon repo. Choose 1-5 files to create or rewrite IN FULL (content = the complete new file). Keep changes small and consistent with the repo. Available paths: ${tree.tree
      .map((t) => t.path)
      .slice(0, 120)
      .join(", ")}`,
    `issue #${issue.number}: ${issue.title}\nbody: ${issue.body ?? ""}\n\ncomments:\n${thread}`,
  );

  for (const f of files) await checkFile(f.path, f.content);

  const branch = `agent/issue-${issue.number}`;
  await cutBranch(branch);
  for (const f of files) await landFile(issue.number, branch, summary, f);
  const prUrl = await raisePull(issue.number, branch, summary);
  await comment(
    issue.number,
    `Done — PR ${prUrl} is up, connected to this issue. The microworkers ran clean. Once merged you can check the result on the Pages site: ${env.pagesUrl} 🎉`,
  );
  row.phase = "delivered";
};

/** the phase row for an issue, minted on first sight */
const rowFor = (state: State, n: number): PhaseRow =>
  state.issues[n] ?? (state.issues[n] = { phase: "seen", lastComment: 0 });

/** clarified + an accepting human comment ⇒ accepted (deliver on
 *  THIS sweep); returns true when the row is due for delivery */
const dueForDelivery = (row: PhaseRow, fresh: Comment[]): boolean => {
  if (row.phase === "clarified" && fresh.some((c) => ACCEPT_RE.test(c.body)))
    row.phase = "accepted";
  return row.phase === "accepted";
};

export async function sweep(state: State): Promise<void> {
  for (const issue of await openIssues()) {
    const row = rowFor(state, issue.number);
    if (row.phase === "delivered") continue;
    const { comments, fresh } = await freshComments(row, issue.number);
    if (row.phase === "seen") {
      await phaseSeen(issue, row);
      continue;
    }
    if (dueForDelivery(row, fresh)) await phaseDeliver(issue, comments, row);
  }
}
