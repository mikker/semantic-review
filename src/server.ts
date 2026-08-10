import { createServer } from "node:http";
import { spawn } from "node:child_process";
import type { ReviewResult } from "./review";

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
