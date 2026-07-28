import { run, type RunResult } from "./proc";

type Runner = (argv: string[]) => Promise<RunResult>;

export async function getGitDiff(gitArgs: string[], execute: Runner = run): Promise<string> {
  const args = gitArgs.length > 0 ? gitArgs : ["HEAD"];
  const tracked = await execute(["git", "diff", "--no-color", ...args]);
  if (tracked.code !== 0) throw new Error(`git diff failed: ${tracked.stderr.trim()}`);
  if (gitArgs.length > 0) return tracked.stdout;

  const untracked = await execute(["git", "ls-files", "--others", "--exclude-standard", "-z"]);
  if (untracked.code !== 0) throw new Error(`git ls-files failed: ${untracked.stderr.trim()}`);

  let diff = tracked.stdout;
  for (const path of untracked.stdout.split("\0").filter(Boolean)) {
    const added = await execute(["git", "diff", "--no-color", "--no-index", "--", "/dev/null", path]);
    if (added.code !== 0 && added.code !== 1) {
      throw new Error(`git diff failed for untracked file ${path}: ${added.stderr.trim()}`);
    }
    diff += added.stdout;
  }
  return diff;
}
