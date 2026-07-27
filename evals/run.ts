#!/usr/bin/env bun
// Scores backend/model/effort combinations on the fixture diffs in evals/cases/.
// The checks are structural — does the analysis reference real hunks, stay brief,
// only draw sensible diagrams — so runs are comparable across models and prompts.
//
//   bun evals/run.ts                        # default backend, all cases
//   bun evals/run.ts --model claude-sonnet-5 --effort medium
//   bun evals/run.ts --with anthropic,codex evals/cases/tiered-report.diff

import type { Analysis } from "../src/analysis";
import { resolveBackends, type AnalyzeOpts } from "../src/backends";
import { diffForModel, hunkById, parseDiff, type DiffFile } from "../src/diff";
import { renderReport } from "../src/render";

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

function scoreAnalysis(analysis: Analysis, files: DiffFile[]): Check[] {
  const hunks = hunkById(files);
  const snippets = analysis.sections.flatMap((s) => s.snippets);

  const badIds = snippets.filter((s) => !hunks.has(s.hunk_id)).map((s) => s.hunk_id);

  const emptyRanges = snippets.filter((s) => {
    const entry = hunks.get(s.hunk_id);
    if (!entry || s.from == null || s.to == null) return false;
    return !entry.hunk.lines.some((l) => {
      const no = l.newNo ?? l.oldNo;
      return no != null && no >= s.from! && no <= s.to!;
    });
  });

  const longSnippets = snippets.filter((s) => {
    const entry = hunks.get(s.hunk_id);
    if (!entry) return false;
    const count =
      s.from == null || s.to == null
        ? entry.hunk.lines.length
        : entry.hunk.lines.filter((l) => {
            const no = l.newNo ?? l.oldNo;
            return no != null && no >= s.from! && no <= s.to!;
          }).length;
    return count > 20;
  });

  const badDiagrams = [analysis.diagram, ...analysis.sections.map((s) => s.diagram)].filter(
    (d) => d !== "" && !/^\s*(flowchart|graph|sequenceDiagram)/.test(d),
  );

  return [
    { name: "hunk ids exist", pass: badIds.length === 0, detail: badIds.join(", ") },
    {
      name: "ranges hit lines",
      pass: emptyRanges.length === 0,
      detail: emptyRanges.map((s) => `${s.hunk_id}:${s.from}-${s.to}`).join(", "),
    },
    {
      name: "snippets ≤20 lines",
      pass: longSnippets.length === 0,
      detail: longSnippets.map((s) => s.hunk_id).join(", "),
    },
    { name: "has snippets", pass: snippets.length > 0, detail: `${snippets.length}` },
    {
      name: "1-6 sections",
      pass: analysis.sections.length >= 1 && analysis.sections.length <= 6,
      detail: `${analysis.sections.length}`,
    },
    {
      name: "summary ≤ 350 chars",
      pass: analysis.summary.length <= 350,
      detail: `${analysis.summary.length}`,
    },
    { name: "diagrams look mermaid", pass: badDiagrams.length === 0, detail: `${badDiagrams.length} odd` },
  ];
}

// -- arg parsing (mirrors src/cli.ts flags) ----------------------------------

const args = process.argv.slice(2);
let withBackends: string[] | null = null;
const opts: AnalyzeOpts = {};
const caseFiles: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--with") withBackends = args[++i].split(",");
  else if (args[i] === "--model") opts.model = args[++i];
  else if (args[i] === "--effort") opts.effort = args[++i] as AnalyzeOpts["effort"];
  else caseFiles.push(args[i]);
}
if (caseFiles.length === 0) {
  const glob = new Bun.Glob("evals/cases/*.diff");
  for await (const f of glob.scan(import.meta.dir + "/..")) caseFiles.push(f);
  caseFiles.sort();
}

const backends = await resolveBackends(withBackends);
const label = [opts.model, opts.effort].filter(Boolean).join(" / ") || "defaults";

for (const caseFile of caseFiles) {
  const files = parseDiff(await Bun.file(caseFile).text());
  const annotated = diffForModel(files);

  for (const backend of backends) {
    const started = Date.now();
    let checks: Check[];
    let error = "";
    let outFile = "";
    try {
      const analysis = await backend.analyze(annotated, opts);
      checks = scoreAnalysis(analysis, files);
      // Save the raw analysis and a browsable report next to the cases.
      const caseName = caseFile.split("/").pop()!.replace(/\.diff$/, "");
      const modelSlug = opts.model ? `-${opts.model.replace(/[^\w.-]+/g, "-")}` : "";
      outFile = `evals/out/${caseName}.${backend.name}${modelSlug}`;
      await Bun.write(`${outFile}.json`, JSON.stringify(analysis, null, 2));
      await Bun.write(`${outFile}.html`, await renderReport([{ backend: backend.name, analysis }], files));
    } catch (e) {
      checks = [];
      error = e instanceof Error ? e.message : String(e);
    }
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const passed = checks.filter((c) => c.pass).length;

    console.log(`\n${caseFile} · ${backend.name} (${label}) · ${secs}s · ${passed}/${checks.length}`);
    if (error) console.log(`  ✗ failed: ${error.slice(0, 200)}`);
    if (outFile) console.log(`  → ${outFile}.html`);
    for (const c of checks) console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  }
}
