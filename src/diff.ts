// Parses `git diff` unified output into files and hunks with stable ids (h1, h2, ...).

export interface DiffLine {
  kind: "context" | "add" | "del";
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface Hunk {
  id: string;
  header: string; // "@@ -10,6 +10,8 @@ fn foo()"
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath: string;
  status: "modified" | "added" | "deleted" | "renamed" | "binary";
  hunks: Hunk[];
}

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let hunkCount = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/^diff --git a\/(.*) b\/(.*)$/);
      file = {
        path: m ? m[2] : line.slice("diff --git ".length),
        oldPath: m ? m[1] : "",
        status: "modified",
        hunks: [],
      };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (line.startsWith("new file mode")) file.status = "added";
    else if (line.startsWith("deleted file mode")) file.status = "deleted";
    else if (line.startsWith("rename from")) file.status = "renamed";
    else if (line.startsWith("Binary files")) file.status = "binary";

    const hm = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hm) {
      oldNo = parseInt(hm[1], 10);
      newNo = parseInt(hm[2], 10);
      hunk = { id: `h${++hunkCount}`, header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "add", oldNo: null, newNo: newNo++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      hunk.lines.push({ kind: "del", oldNo: oldNo++, newNo: null, text: line.slice(1) });
    } else if (line.startsWith(" ") || line === "") {
      hunk.lines.push({ kind: "context", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    }
    // "\ No newline at end of file" and other metadata lines are dropped.
  }

  return files;
}

export function hunkById(files: DiffFile[]): Map<string, { file: DiffFile; hunk: Hunk }> {
  const map = new Map<string, { file: DiffFile; hunk: Hunk }>();
  for (const file of files) for (const hunk of file.hunks) map.set(hunk.id, { file, hunk });
  return map;
}

// The annotated diff we show the model: every hunk labeled with its id.
export function diffForModel(files: DiffFile[]): string {
  const parts: string[] = [];
  for (const file of files) {
    if (file.status === "binary") {
      parts.push(`### ${file.path} (binary, ${file.status})`);
      continue;
    }
    for (const hunk of file.hunks) {
      parts.push(`### hunk ${hunk.id} — ${file.path} (${file.status}) ${hunk.header}`);
      parts.push(
        hunk.lines
          .map((l) => (l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ") + l.text)
          .join("\n"),
      );
    }
  }
  return parts.join("\n");
}
