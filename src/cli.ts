#!/usr/bin/env node
// semantic-review — semantic diff review.
// Reads a git diff (stdin or `git diff` args), asks an LLM backend for a
// narrative report, serves it for human review, and prints the feedback to
// stdout when the reviewer clicks Done.

import { parseDiff, diffForModel } from "./diff";
import { resolveBackends, runBackends, BACKENDS } from "./backends";
import { AnalysisSchema, analysisPrompt, type AnalysisResult } from "./analysis";
import { getGitDiff } from "./git";
import { renderReport } from "./render";
import { serveReview } from "./server";
import { formatReview } from "./review";
import { readFile } from "node:fs/promises";
import { configuredBackends, EFFORTS, isEffort, loadConfig, type Effort } from "./config";
import { exportReview } from "./export";

const USAGE = `usage: semantic-review [options] [git diff args...]

Reads the diff from stdin if piped, otherwise runs \`git diff <args>\`
(default: git diff HEAD plus untracked files). Prints the human's review feedback to stdout.

options:
  --with <backend,...>   backends: ${Object.keys(BACKENDS).join(", ")} (default: auto-detect)
  --model <id>           model passed to the selected backend (anthropic default:
                         claude-opus-5, novita default: deepseek/deepseek-v3.2,
                         or SEMANTIC_REVIEW_MODEL)
  --effort <level>       ${EFFORTS.join("|")} (anthropic backend; default: API default)
  --export <file>        write a self-contained review whose Done button copies feedback
  --emit-prompt          print the analysis prompt and exit
  --analysis <file>      render a caller-provided analysis JSON instead of running a backend
  --no-open              don't open the browser

examples:
  semantic-review                      review uncommitted changes
  semantic-review main...HEAD          review a branch
  git diff -U10 | semantic-review      review a piped diff with more context
  semantic-review --with anthropic,codex   two analyses, tabbed
  semantic-review --model claude-sonnet-5 --effort medium   cheaper/faster analysis
  semantic-review --export review.html
  semantic-review --emit-prompt > prompt.txt
  semantic-review --analysis analysis.json`;

async function getDiff(gitArgs: string[]): Promise<string> {
  if (!process.stdin.isTTY) {
    let piped = "";
    for await (const chunk of process.stdin.setEncoding("utf8")) piped += chunk;
    if (piped.trim()) return piped;
  }
  return getGitDiff(gitArgs);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE);
    return;
  }
  const config = await loadConfig();
  const gitArgs: string[] = [];
  let withBackends: string[] | null = configuredBackends(config.backend);
  let openBrowser = true;
  let model: string | undefined = config.model;
  let effort: Effort | undefined = config.effort;
  let emitPrompt = false;
  let analysisPath: string | undefined;
  let exportPath: string | undefined;
  const hasExplicitAnalysisOptions = argv.some((arg) => ["--with", "--model", "--effort"].includes(arg));

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-open") {
      openBrowser = false;
    } else if (arg === "--with") {
      withBackends = configuredBackends(argv[++i]);
    } else if (arg === "--model") {
      model = argv[++i];
    } else if (arg === "--effort") {
      const level = argv[++i];
      if (!isEffort(level)) {
        throw new Error(`invalid --effort "${level}" (${EFFORTS.join("|")})`);
      }
      effort = level;
    } else if (arg === "--emit-prompt") {
      emitPrompt = true;
    } else if (arg === "--analysis") {
      analysisPath = argv[++i];
      if (!analysisPath) throw new Error("--analysis requires a file path");
    } else if (arg === "--export") {
      exportPath = argv[++i];
      if (!exportPath) throw new Error("--export requires a file path");
    } else {
      gitArgs.push(arg);
    }
  }

  if (emitPrompt && analysisPath) throw new Error("--emit-prompt cannot be combined with --analysis");
  if (analysisPath && hasExplicitAnalysisOptions) {
    throw new Error("--analysis cannot be combined with --with, --model, or --effort");
  }

  const diff = await getDiff(gitArgs);
  const files = parseDiff(diff);
  const hunkCount = files.reduce((n, f) => n + f.hunks.length, 0);
  if (hunkCount === 0) {
    console.error("semantic-review: no changes to review");
    process.exit(1);
  }
  const changeSummary = `${hunkCount} hunk${hunkCount === 1 ? "" : "s"} across ${files.length} file${files.length === 1 ? "" : "s"}`;

  const annotated = diffForModel(files);
  if (emitPrompt) {
    console.log(analysisPrompt(annotated));
    return;
  }

  let results: AnalysisResult[];
  if (analysisPath) {
    const analysis = AnalysisSchema.parse(JSON.parse(await readFile(analysisPath, "utf8")));
    results = [{ backend: "host", analysis }];
    console.error(`semantic-review: rendering caller analysis for ${changeSummary}…`);
  } else {
    const backends = await resolveBackends(withBackends);
    console.error(`semantic-review: analyzing ${changeSummary} with ${backends.map((b) => b.name).join(", ")}…`);
    results = await runBackends(backends, annotated, { model, effort });
  }
  const html = await renderReport(results, files, { exportMode: !!exportPath });
  if (exportPath) {
    console.log(await exportReview(exportPath, html));
    return;
  }
  const review = await serveReview(html, openBrowser);

  console.log(formatReview(review, results.length > 1));
}

main().catch((err) => {
  console.error(`semantic-review: ${err.message ?? err}`);
  process.exit(1);
});
