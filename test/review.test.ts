import { describe, expect, test } from "bun:test";
import { formatReview } from "../src/review";

describe("formatReview", () => {
  test("approves when there is nothing to say", () => {
    expect(formatReview({ comments: [], overall: "" }, false)).toBe("Review complete: approved, no comments.");
  });

  test("numbers comments with ref, quote and text", () => {
    const out = formatReview(
      {
        comments: [{ ref: "src/greet.ts:2", quote: "throw new Error", text: "Prefer a typed error." }],
        overall: "Looks good otherwise.",
      },
      false,
    );
    expect(out).toBe(
      [
        "Review feedback (1 comment):",
        "",
        "1. src/greet.ts:2",
        "   > throw new Error",
        "   Prefer a typed error.",
        "",
        "Overall: Looks good otherwise.",
      ].join("\n"),
    );
  });

  test("appends included agent notes, tagged per backend in multi-tab reports", () => {
    const review = {
      comments: [],
      overall: "",
      notes: [{ backend: "anthropic", items: ["No test covers the throw path."] }],
    };
    expect(formatReview(review, false)).toBe(
      ["Review complete: approved, no comments.", "", "Agent's notes:", "- No test covers the throw path."].join("\n"),
    );
    expect(formatReview(review, true)).toContain("Agent's notes [anthropic]:");
  });

  test("tags comments with their backend only in multi-tab reports", () => {
    const review = { comments: [{ ref: "report", text: "hm", backend: "codex" }], overall: "" };
    expect(formatReview(review, true)).toContain("1. [codex] report");
    expect(formatReview(review, false)).toContain("1. report");
  });

  test("can run unchanged when embedded in an exported report", () => {
    const embedded = new Function(`return (${formatReview.toString()})`)() as typeof formatReview;
    const review = { comments: [{ ref: "report", text: "Fix this." }], overall: "" };
    expect(embedded(review, false)).toBe(formatReview(review, false));
  });
});
