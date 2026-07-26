#!/usr/bin/env bun
// semrev — semantic diff review.
// Reads a git diff (stdin or `git diff` args), asks an LLM backend for a
// narrative report, serves it for human review, and prints the feedback to
// stdout when the reviewer clicks Done.

import { parseDiff, diffForModel } from "./diff";
import { resolveBackends, runBackends, BACKENDS } from "./backends";
import { renderReport } from "./render";
import { serveReview, formatReview } from "./server";

const USAGE = `usage: semrev [--with <backend,...>] [--no-open] [git diff args...]

Reads the diff from stdin if piped, otherwise runs \`git diff <args>\`
(default: git diff HEAD). Prints the human's review feedback to stdout.

backends: ${Object.keys(BACKENDS).join(", ")} (default: auto-detect)

examples:
  semrev                      review uncommitted changes
  semrev main...HEAD          review a branch
  git diff -U10 | semrev      review a piped diff with more context
  semrev --with anthropic,codex   two analyses, tabbed`;

async function getDiff(gitArgs: string[]): Promise<string> {
  if (!process.stdin.isTTY) {
    const piped = await Bun.stdin.text();
    if (piped.trim()) return piped;
  }
  const args = gitArgs.length > 0 ? gitArgs : ["HEAD"];
  const proc = Bun.spawn(["git", "diff", "--no-color", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`git diff failed: ${err.trim()}`);
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const gitArgs: string[] = [];
  let withBackends: string[] | null = null;
  let openBrowser = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      return;
    } else if (arg === "--no-open") {
      openBrowser = false;
    } else if (arg === "--with") {
      withBackends = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      gitArgs.push(arg);
    }
  }

  const diff = await getDiff(gitArgs);
  const files = parseDiff(diff);
  const hunkCount = files.reduce((n, f) => n + f.hunks.length, 0);
  if (hunkCount === 0) {
    console.error("semrev: no changes to review");
    process.exit(1);
  }

  const backends = await resolveBackends(withBackends);
  console.error(
    `semrev: analyzing ${hunkCount} hunk${hunkCount === 1 ? "" : "s"} across ${files.length} file${files.length === 1 ? "" : "s"} with ${backends.map((b) => b.name).join(", ")}…`,
  );

  const annotated = diffForModel(files);
  const results = await runBackends(backends, annotated);
  const html = await renderReport(results, files);
  const review = await serveReview(html, openBrowser);

  console.log(formatReview(review, results.length > 1));
}

main().catch((err) => {
  console.error(`semrev: ${err.message ?? err}`);
  process.exit(1);
});
