import { describe, expect, test } from "bun:test";
import { getGitDiff } from "../src/git";
import type { RunResult } from "../src/proc";

const result = (stdout = "", code = 0, stderr = ""): RunResult => ({ stdout, stderr, code });

function runner(responses: RunResult[]) {
  const calls: string[][] = [];
  return {
    calls,
    execute: async (argv: string[]) => {
      calls.push(argv);
      const response = responses.shift();
      if (!response) throw new Error("unexpected command");
      return response;
    },
  };
}

describe("getGitDiff", () => {
  test("returns exactly the requested custom diff", async () => {
    const mock = runner([result("branch diff")]);

    expect(await getGitDiff(["main...HEAD"], mock.execute)).toBe("branch diff");
    expect(mock.calls).toEqual([["git", "diff", "--no-color", "main...HEAD"]]);
  });

  test("includes every untracked file in the default diff", async () => {
    const mock = runner([
      result("tracked diff\n"),
      result("new.ts\0path with spaces.md\0"),
      result("new file diff\n", 1),
      result("spaced file diff\n", 1),
    ]);

    expect(await getGitDiff([], mock.execute)).toBe("tracked diff\nnew file diff\nspaced file diff\n");
    expect(mock.calls.slice(2)).toEqual([
      ["git", "diff", "--no-color", "--no-index", "--", "/dev/null", "new.ts"],
      ["git", "diff", "--no-color", "--no-index", "--", "/dev/null", "path with spaces.md"],
    ]);
  });

  test("reports failures while diffing an untracked file", async () => {
    const mock = runner([result(), result("broken.ts\0"), result("", 2, "permission denied")]);

    expect(getGitDiff([], mock.execute)).rejects.toThrow(
      "git diff failed for untracked file broken.ts: permission denied",
    );
  });
});
