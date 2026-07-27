import { describe, expect, test } from "bun:test";
import { diffForModel, hunkById, parseDiff } from "../src/diff";

const MODIFIED = `diff --git a/src/greet.ts b/src/greet.ts
index 1234567..89abcde 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,4 @@ export function greet
 export function greet(name: string) {
-  return "Hello, " + name;
+  if (!name.trim()) throw new Error("blank name");
+  return \`Hello, \${name}\`;
 }
`;

describe("parseDiff", () => {
  test("tracks old/new line numbers through context, add and del lines", () => {
    const [file] = parseDiff(MODIFIED);
    expect(file.path).toBe("src/greet.ts");
    expect(file.status).toBe("modified");
    expect(file.hunks).toHaveLength(1);

    const lines = file.hunks[0].lines;
    expect(lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ["context", 1, 1],
      ["del", 2, null],
      ["add", null, 2],
      ["add", null, 3],
      ["context", 3, 4],
    ]);
  });

  test("assigns stable hunk ids across files", () => {
    const diff = [MODIFIED, MODIFIED.replace(/src\/greet\.ts/g, "src/other.ts")].join("");
    const files = parseDiff(diff);
    expect(files.map((f) => f.hunks[0].id)).toEqual(["h1", "h2"]);
    expect(hunkById(files).get("h2")?.file.path).toBe("src/other.ts");
  });

  test("detects added, deleted, renamed and binary files", () => {
    const diff = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1 @@
+export {};
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-export {};
diff --git a/old-name.ts b/new-name.ts
rename from old-name.ts
rename to new-name.ts
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
`;
    const files = parseDiff(diff);
    expect(files.map((f) => f.status)).toEqual(["added", "deleted", "renamed", "binary"]);
    expect(files[2].path).toBe("new-name.ts");
    expect(files[2].oldPath).toBe("old-name.ts");
  });

  test("ignores 'no newline' markers", () => {
    const diff = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`;
    const [file] = parseDiff(diff);
    expect(file.hunks[0].lines.map((l) => l.text)).toEqual(["old", "new"]);
  });
});

describe("diffForModel", () => {
  test("prefixes lines with new-file numbers, deleted lines with -oldNo", () => {
    const out = diffForModel(parseDiff(MODIFIED));
    expect(out).toContain("### hunk h1 — src/greet.ts (modified) @@ -1,3 +1,4 @@ export function greet");
    expect(out).toContain('1| export function greet(name: string) {');
    expect(out).toContain('-2|-  return "Hello, " + name;');
    expect(out).toContain('2|+  if (!name.trim()) throw new Error("blank name");');
  });
});
