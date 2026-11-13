// buckle.hook.pre-commit.ts — MECHANICAL: on commit, run qlty with --fix
// just before committing; abort the commit if there were errors.
// Wired by `git config core.hooksPath .githooks`. No skips, no smarts:
// fmt fixes and re-stages; check fails → exit 1 → git aborts.
import { execSync } from "node:child_process";

function run(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "inherit" });
    return true;
  } catch {
    return false;
  }
}

const staged = execSync("git diff --cached --name-only --diff-filter=ACM", {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((f) => f.length > 0);

if (staged.length === 0) process.exit(0);

// 1. fix: format the staged files in place (--fix semantics), re-stage
if (!run(`qlty fmt --no-upgrade-check -- ${staged.join(" ")}`)) {
  console.error("pre-commit: qlty fmt failed — commit aborted");
  process.exit(1);
}
execSync(`git add -- ${staged.join(" ")}`);

// 2. check: any remaining error aborts the commit
if (!run(`qlty check --no-upgrade-check -- ${staged.join(" ")}`)) {
  console.error("pre-commit: qlty check reported errors — commit aborted");
  process.exit(1);
}

process.exit(0);
