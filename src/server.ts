import { createServer } from "node:http";
import { spawn } from "node:child_process";

export interface ReviewComment {
  ref: string;
  quote?: string;
  text: string;
  backend?: string;
}

export interface ReviewResult {
  comments: ReviewComment[];
  overall: string;
  // Agent's notes the reviewer checked "Include in review" for, per backend.
  notes?: { backend: string; items: string[] }[];
}

// Serves the report on localhost and resolves when the reviewer clicks Done.
export function serveReview(html: string, openBrowser: boolean): Promise<ReviewResult> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (path === "/" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (path === "/done" && req.method === "POST") {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const result = JSON.parse(body) as ReviewResult;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }), () => {
            server.close();
            server.closeAllConnections();
            resolve({ comments: result.comments ?? [], overall: result.overall ?? "", notes: result.notes ?? [] });
          });
        });
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      const url = `http://127.0.0.1:${port}/`;
      console.error(`semantic-review: review at ${url} — waiting for Done…`);
      if (openBrowser) {
        const opener = process.platform === "darwin" ? "open" : "xdg-open";
        spawn(opener, [url], { stdio: "ignore" }).on("error", () => {});
      }
    });
  });
}

export function formatReview(result: ReviewResult, multiTab: boolean): string {
  const lines: string[] = [];
  const notes = result.notes ?? [];
  if (result.comments.length === 0 && !result.overall) {
    lines.push("Review complete: approved, no comments.");
  } else {
    lines.push(`Review feedback (${result.comments.length} comment${result.comments.length === 1 ? "" : "s"}):`);
    result.comments.forEach((c, i) => {
      const tag = multiTab && c.backend ? `[${c.backend}] ` : "";
      lines.push("", `${i + 1}. ${tag}${c.ref}`);
      if (c.quote) lines.push(...c.quote.split("\n").map((q) => `   > ${q}`));
      lines.push(...c.text.split("\n").map((t) => `   ${t}`));
    });
    if (result.overall) lines.push("", `Overall: ${result.overall}`);
  }
  for (const n of notes) {
    lines.push("", multiTab ? `Agent's notes [${n.backend}]:` : "Agent's notes:");
    lines.push(...n.items.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}
