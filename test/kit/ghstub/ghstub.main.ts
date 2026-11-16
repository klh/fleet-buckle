// ghstub.main.ts — the GitHub REST stub: an in-memory repo face for
// the durable worker's hermetic e2e. Serves EXACTLY the REST subset
// worker.main.ts touches (issues, comments, git refs/refs/trees,
// contents, pulls), plus a CONTROL face for the spec: POST an issue
// or an author comment (user-agent tells author from bot — the
// worker identifies as `fleet-worker`), GET /_state to assert what
// the worker did. Issue numbers derive from boot time so a stale
// worker-state volume from an earlier run can never collide with
// this run's numbers. WEBHOOK DELIVERY: on issue/comment create the
// stub POSTs a signed wake to the worker (x-hub-signature-256 over
// the exact bytes sent) — the event seam; the worker's poll stays
// the backstop. The stub image carries no deps: every body read is
// a castless structural probe (the strOf walk), never an alias or
// an `as` shape.
import { createHmac } from "node:crypto";

// in-memory repo state — shapes are constructed here, serialized as
// is by /_state; nothing reads them back through a type
const issues: unknown[] = [];
const commentsByIssue = new Map<number, unknown[]>();
const branches: { ref: string; sha: string }[] = [];
const files: { path: string; branch: string; contentB64: string }[] = [];
const pulls: unknown[] = [];

// webhook delivery record — the spec asserts the seam from here
// (event, action, issue, status), never from worker logs
const WEBHOOK_URL = process.env["GHSTUB_WEBHOOK_URL"] ?? "";
const WEBHOOK_SECRET = process.env["GHSTUB_WEBHOOK_SECRET"] ?? "";
const webhooks: {
  at: number;
  event: string;
  action: string;
  issue: number;
  status: number | string;
}[] = [];

async function deliver(event: string, action: string, issue: number): Promise<void> {
  if (WEBHOOK_URL === "") return;
  const payload = JSON.stringify({
    action,
    issue: { number: issue },
    sender: { login: "gh-stub" },
  });
  const sig = `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex")}`;
  try {
    const r = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-hub-signature-256": sig,
      },
      body: payload,
      signal: AbortSignal.timeout(3000),
    });
    webhooks.push({ at: Date.now(), event, action, issue, status: r.status });
  } catch (e) {
    webhooks.push({
      at: Date.now(),
      event,
      action,
      issue,
      status: e instanceof Error ? e.name : "error",
    });
  }
}

const MAIN_SHA = "a".repeat(40);
let nextCommentId = 1;
// boot-unique issue numbers (grows with time, never repeats per boot)
let nextIssueNumber = Math.floor(Date.now() / 1000) % 1_000_000;

const comments = (n: number): unknown[] => {
  const list = commentsByIssue.get(n);
  if (list === undefined) {
    const fresh: unknown[] = [];
    commentsByIssue.set(n, fresh);
    return fresh;
  }
  return list;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

/** the login a POST rides as: the worker speaks with its
 *  user-agent, everyone else is the repo writer */
const loginOf = (req: Request): string =>
  req.headers.get("user-agent") === "fleet-worker" ? "fleet-worker[bot]" : "thewriter";

/** a JSON object body, or {} when unparsable — the ONLY body read */
const readBody = async (req: Request): Promise<object> => {
  try {
    const v: unknown = JSON.parse(await req.text());
    if (typeof v === "object" && v !== null) return v;
  } catch {
    // non-JSON body: treat as empty
  }
  return {};
};

/** string field of a body — "" when absent (castless entry walk) */
const strOf = (body: object, key: string): string => {
  for (const [k, v] of Object.entries(body)) if (k === key && typeof v === "string") return v;
  return "";
};

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: 8080,
  fetch: async (req) => {
    const url = new URL(req.url);
    const path = url.pathname; // query (ref=, per_page=…) is ignored
    const bot = loginOf(req);

    // ── control face (the spec's hands) ──
    if (req.method === "GET" && path === "/healthz") return json({ ok: true, status: "up" });
    if (req.method === "GET" && path === "/_state")
      return json({
        issues,
        comments: Object.fromEntries(commentsByIssue),
        branches,
        files,
        pulls,
        webhooks,
      });

    // ── the repo prefix: /repos/<owner>/<repo>/… ──
    const repo = /^\/repos\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(path);
    if (repo === null) return json({ message: "Not Found" }, 404);
    const owner = repo[1] ?? "";
    const name = repo[2] ?? "";
    const rest = repo[3] ?? "";

    // repo metadata (the worker resolves the default branch from it —
    // the live fork lesson: never assume "main")
    if (req.method === "GET" && rest === "")
      return json({ default_branch: "main", full_name: `${owner}/${name}` });

    // issues list (open only — the stub never closes)
    if (req.method === "GET" && rest === "issues") return json(issues);

    // issue create (the test files the work)
    if (req.method === "POST" && rest === "issues") {
      const body = await readBody(req);
      const issue = {
        number: ++nextIssueNumber,
        title: strOf(body, "title"),
        body: strOf(body, "body"),
        state: "open",
        user: { login: bot },
        html_url: `http://gh-stub/issues/${nextIssueNumber}`,
      };
      issues.push(issue);
      void deliver("issues", "opened", issue.number);
      return json(issue, 201);
    }

    // issue comments list / create
    const issueComments = /^issues\/(\d+)\/comments$/.exec(rest);
    if (issueComments !== null) {
      const n = Number(issueComments[1]);
      if (req.method === "GET") return json(comments(n));
      if (req.method === "POST") {
        const body = await readBody(req);
        const comment = {
          id: nextCommentId++,
          body: strOf(body, "body"),
          user: { login: bot },
        };
        comments(n).push(comment);
        // the worker's own comments do not wake the worker (no
        // self-wake loop); the author's do
        if (bot !== "fleet-worker[bot]") void deliver("issue_comment", "created", n);
        return json(comment, 201);
      }
    }

    // git trees (a plausible repo skeleton for the planner prompt)
    if (req.method === "GET" && rest === "git/trees/main")
      return json({
        sha: MAIN_SHA,
        tree: [{ path: "README.md" }, { path: "docs/index.html" }, { path: "src/app.js" }],
      });

    // main ref (branch point)
    if (req.method === "GET" && rest === "git/ref/heads/main")
      return json({ object: { sha: MAIN_SHA } });

    // branch create
    if (req.method === "POST" && rest === "git/refs") {
      const body = await readBody(req);
      const ref = strOf(body, "ref");
      const sha = strOf(body, "sha");
      branches.push({ ref, sha });
      return json({ ref, object: { sha } }, 201);
    }

    // contents: the stub serves no existing files (worker plans NEW
    // files) — GET 404s like GitHub, PUT records the write
    const contents = /^contents\/(.+)$/.exec(rest);
    if (contents !== null) {
      const filePath = decodeURIComponent(contents[1] ?? "");
      if (req.method === "GET") return json({ message: "Not Found" }, 404);
      if (req.method === "PUT") {
        const body = await readBody(req);
        files.push({
          path: filePath,
          branch: strOf(body, "branch"),
          contentB64: strOf(body, "content"),
        });
        return json({ content: { path: filePath, sha: "b".repeat(40) } }, 201);
      }
    }

    // pull create
    if (req.method === "POST" && rest === "pulls") {
      const body = await readBody(req);
      const pull = {
        number: issues.length + 100 + pulls.length,
        title: strOf(body, "title"),
        head: strOf(body, "head"),
        base: strOf(body, "base"),
        body: strOf(body, "body"),
        html_url: `http://gh-stub/pulls/${pulls.length + 1}`,
      };
      pulls.push(pull);
      return json(pull, 201);
    }

    return json({ message: "Not Found" }, 404);
  },
});
console.log(`github stub on ${server.url.href}`);
