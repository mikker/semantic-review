export interface ReviewComment {
  ref: string;
  quote?: string;
  text: string;
  backend?: string;
}

export interface ReviewResult {
  comments: ReviewComment[];
  overall: string;
  notes?: { backend: string; items: string[] }[];
}

// Kept self-contained so the same function can be embedded in exported reports.
export function formatReview(result: ReviewResult, multiTab: boolean): string {
  const lines: string[] = [];
  const notes = result.notes ?? [];
  if (result.comments.length === 0 && !result.overall) {
    lines.push("Review complete: approved, no comments.");
  } else {
    lines.push(`Review feedback (${result.comments.length} comment${result.comments.length === 1 ? "" : "s"}):`);
    result.comments.forEach((comment, index) => {
      const tag = multiTab && comment.backend ? `[${comment.backend}] ` : "";
      lines.push("", `${index + 1}. ${tag}${comment.ref}`);
      if (comment.quote) lines.push(...comment.quote.split("\n").map((line) => `   > ${line}`));
      lines.push(...comment.text.split("\n").map((line) => `   ${line}`));
    });
    if (result.overall) lines.push("", `Overall: ${result.overall}`);
  }
  for (const note of notes) {
    lines.push("", multiTab ? `Agent's notes [${note.backend}]:` : "Agent's notes:");
    lines.push(...note.items.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}
