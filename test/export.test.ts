import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportReview } from "../src/export";

describe("export", () => {
  test("writes HTML to a resolved path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "semantic-review-export-"));
    const requestedPath = join(dir, "nested", "..", "review.html");
    const outputPath = await exportReview(requestedPath, "<html>review</html>");

    expect(outputPath).toBe(join(dir, "review.html"));
    expect(await readFile(outputPath, "utf8")).toBe("<html>review</html>");
  });
});
