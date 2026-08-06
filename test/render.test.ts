import { describe, expect, test } from "bun:test";
import { parseDiff } from "../src/diff";
import { renderReport } from "../src/render";

describe("static report", () => {
  test("is self-contained and copies feedback instead of posting it", async () => {
    const files = parseDiff("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n");
    const html = await renderReport(
      [{
        backend: "openai",
        analysis: {
          title: "Change",
          summary: "Summary",
          diagram: "flowchart LR\nA --> B",
          sections: [{ heading: "Update", intro: "Intro", diagram: "", snippets: [{ hunk_id: "h1", from: 1, to: 1, note: "" }] }],
          notes: ["Check it."],
        },
      }],
      files,
      { exportMode: true },
    );

    expect(html).not.toContain("cdn.tailwindcss.com");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain('fetch("/done"');
    expect(html).toContain("navigator.clipboard?.writeText");
    expect(html).toContain('id="done"');
    expect(html).toContain('class="lc"');
    expect(html).toContain("Check it.");
    expect(html).toContain(">new</span>");
  });

  test("includes every backend in the standalone selector", async () => {
    const files = parseDiff("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n");
    const result = (backend: string, summary: string) => ({
      backend,
      analysis: { title: "Change", summary, diagram: "", sections: [], notes: [] },
    });
    const html = await renderReport(
      [result("anthropic", "First analysis"), result("openai", "Second analysis")],
      files,
      { exportMode: true },
    );

    expect(html).toContain('<select id="agent"');
    expect(html).toContain('<option value="0">anthropic</option>');
    expect(html).toContain('<option value="1">openai</option>');
    expect(html).toContain("First analysis");
    expect(html).toContain("Second analysis");
    expect(html).toContain("const multiTab = true");
  });
});
