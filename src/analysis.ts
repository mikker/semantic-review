import { z } from "zod";

export const AnalysisSchema = z.object({
  title: z.string(),
  summary: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      prose: z.string(),
      hunk_ids: z.array(z.string()),
    }),
  ),
  notes: z.array(z.string()),
});

export type Analysis = z.infer<typeof AnalysisSchema>;

// One analysis per backend; the report renders a tab per result.
export interface AnalysisResult {
  backend: string; // label, e.g. "anthropic", "claude", "codex"
  analysis: Analysis;
}

export function analysisPrompt(annotatedDiff: string): string {
  return `You are writing a semantic review guide for a git diff. Traditional diffs list files alphabetically; your job is to reorganize the change into a narrative a reviewer can actually follow.

Each hunk below is labeled with an id like "hunk h3". Produce a JSON object with exactly this shape:

{
  "title": "short title for the change",
  "summary": "2-4 sentence overview: what the change does and why, as far as it can be inferred",
  "sections": [
    { "heading": "...", "prose": "...", "hunk_ids": ["h1", "h4"] }
  ],
  "notes": ["risks, smells, or observations worth a reviewer's attention", ...]
}

Rules:
- Group hunks by code path / concern, not by file. Order sections by importance: the core change first, then supporting changes, then mechanical/chore changes.
- Every hunk id must appear in at least one section. A hunk may appear in more than one if it is genuinely relevant to both.
- Prose explains what the code does and why, naming the functions/types involved. Use backticks for identifiers. Plain text otherwise, no markdown headings.
- "notes" is for things a reviewer should double-check: behavior changes, missing tests, edge cases, inconsistencies. Empty array if none.
- Respond with ONLY the JSON object, no fences, no commentary.

The diff:

${annotatedDiff}`;
}

// Lenient JSON extraction for CLI backends that may wrap output in prose or fences.
export function extractAnalysis(raw: string): Analysis {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error(`no JSON object found in output:\n${raw.slice(0, 500)}`);
    text = text.slice(start, end + 1);
  }
  return AnalysisSchema.parse(JSON.parse(text));
}
