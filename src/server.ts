export interface ReviewComment {
  ref: string;
  quote?: string;
  text: string;
  backend?: string;
}

export interface ReviewResult {
  comments: ReviewComment[];
  overall: string;
}

// Serves the report on localhost and resolves when the reviewer clicks Done.
export function serveReview(html: string, openBrowser: boolean): Promise<ReviewResult> {
  return new Promise((resolve) => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/" && req.method === "GET") {
          return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
        if (url.pathname === "/done" && req.method === "POST") {
          const result = (await req.json()) as ReviewResult;
          queueMicrotask(() => {
            server.stop();
            resolve({ comments: result.comments ?? [], overall: result.overall ?? "" });
          });
          return Response.json({ ok: true });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const url = `http://127.0.0.1:${server.port}/`;
    console.error(`semrev: review at ${url} — waiting for Done…`);
    if (openBrowser) {
      const opener = process.platform === "darwin" ? "open" : "xdg-open";
      Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
    }
  });
}

export function formatReview(result: ReviewResult, multiTab: boolean): string {
  const lines: string[] = [];
  if (result.comments.length === 0 && !result.overall) {
    return "Review complete: approved, no comments.";
  }
  lines.push(`Review feedback (${result.comments.length} comment${result.comments.length === 1 ? "" : "s"}):`);
  result.comments.forEach((c, i) => {
    const tag = multiTab && c.backend ? `[${c.backend}] ` : "";
    lines.push("", `${i + 1}. ${tag}${c.ref}`);
    if (c.quote) lines.push(...c.quote.split("\n").map((q) => `   > ${q}`));
    lines.push(...c.text.split("\n").map((t) => `   ${t}`));
  });
  if (result.overall) lines.push("", `Overall: ${result.overall}`);
  return lines.join("\n");
}
