import { createHighlighter, bundledLanguages, type Highlighter } from "shiki";
import type { AnalysisResult } from "./analysis";
import { hunkById, type DiffFile, type Hunk } from "./diff";

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  rb: "ruby", py: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", fish: "fish",
  html: "html", erb: "erb", css: "css", scss: "scss", json: "json", yml: "yaml", yaml: "yaml",
  toml: "toml", md: "markdown", sql: "sql", ex: "elixir", exs: "elixir", vue: "vue", svelte: "svelte",
};

function langFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const lang = LANG_BY_EXT[ext];
  return lang && lang in bundledLanguages ? lang : "text";
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Escaped prose with `code` spans and paragraph breaks.
function prose(text: string): string {
  return text
    .split(/\n\n+/)
    .map((p) => `<p>${esc(p).replace(/`([^`]+)`/g, "<code>$1</code>")}</p>`)
    .join("");
}

function tokenStyle(token: { htmlStyle?: string | Record<string, string>; color?: string }): string {
  if (token.htmlStyle) {
    if (typeof token.htmlStyle === "string") return token.htmlStyle;
    return Object.entries(token.htmlStyle)
      .map(([k, v]) => `${k}:${v}`)
      .join(";");
  }
  return token.color ? `color:${token.color}` : "";
}

function renderHunk(hl: Highlighter, file: DiffFile, hunk: Hunk): string {
  const lang = langFor(file.path);
  const code = hunk.lines.map((l) => l.text).join("\n");
  let tokenLines: { htmlStyle?: string | Record<string, string>; color?: string; content: string }[][];
  try {
    tokenLines = hl.codeToTokens(code, {
      lang: lang as never,
      themes: { light: "github-light", dark: "github-dark" },
    }).tokens;
  } catch {
    tokenLines = hunk.lines.map((l) => [{ content: l.text }]);
  }

  const rows = hunk.lines.map((line, i) => {
    const tokens = tokenLines[i] ?? [{ content: line.text }];
    const codeHtml =
      tokens.map((t) => `<span style="${esc(tokenStyle(t))}">${esc(t.content)}</span>`).join("") || "&nbsp;";
    const lineRef = line.newNo != null ? `${file.path}:${line.newNo}` : `${file.path}:${line.oldNo} (old)`;
    return `<tr class="${line.kind}" data-ref="${esc(lineRef)}">
      <td class="g">${line.oldNo ?? ""}</td><td class="g">${line.newNo ?? ""}</td>
      <td class="m">${line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}</td>
      <td class="c"><button class="lc" title="Comment on this line">＋</button>${codeHtml}</td>
    </tr>`;
  });

  return `<div class="hunk" id="${hunk.id}">
    <div class="hunk-head"><span class="path">${esc(file.path)}</span><span class="hh">${esc(hunk.header)}</span></div>
    <table class="diff"><tbody>${rows.join("")}</tbody></table>
  </div>`;
}

export async function renderReport(results: AnalysisResult[], files: DiffFile[]): Promise<string> {
  const langs = [...new Set(files.map((f) => langFor(f.path)).filter((l) => l !== "text"))];
  const hl = await createHighlighter({ themes: ["github-light", "github-dark"], langs });
  const hunks = hunkById(files);
  const hunkHtml = new Map<string, string>();
  for (const [id, { file, hunk }] of hunks) hunkHtml.set(id, renderHunk(hl, file, hunk));

  const tabs = results
    .map(
      (r, i) =>
        `<button class="tab${i === 0 ? " active" : ""}" data-tab="${i}">${esc(r.backend)}</button>`,
    )
    .join("");

  const panels = results
    .map((r, i) => {
      const sections = r.analysis.sections
        .map(
          (s, si) => `<section data-ctx="${esc(s.heading)}">
            <h2>${esc(s.heading)}</h2>
            <div class="prose">${prose(s.prose)}</div>
            ${s.hunk_ids.map((id) => hunkHtml.get(id) ?? `<p class="missing">unknown hunk ${esc(id)}</p>`).join("")}
          </section>`,
        )
        .join("");
      const notes = r.analysis.notes.length
        ? `<section data-ctx="Reviewer notes"><h2>Reviewer notes</h2><ul class="notes">${r.analysis.notes
            .map((n) => `<li>${esc(n).replace(/`([^`]+)`/g, "<code>$1</code>")}</li>`)
            .join("")}</ul></section>`
        : "";
      return `<div class="panel${i === 0 ? " active" : ""}" data-panel="${i}" data-backend="${esc(r.backend)}">
        <div class="summary prose" data-ctx="Summary">${prose(r.analysis.summary)}</div>
        ${sections}${notes}
      </div>`;
    })
    .join("");

  const title = results[0].analysis.title;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — semrev</title>
<style>
:root {
  --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --border: #d1d9e0;
  --panel: #f6f8fa; --add-bg: #dafbe1; --del-bg: #ffebe9; --accent: #0969da;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0d1117; --fg: #e6edf3; --muted: #8d96a0; --border: #30363d;
    --panel: #161b22; --add-bg: #12261e; --del-bg: #2d1214; --accent: #4493f8; }
  .diff span[style] { color: var(--shiki-dark, inherit) !important; }
}
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.55 -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--fg); }
header { position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 12px;
  padding: 10px 20px; background: var(--bg); border-bottom: 1px solid var(--border); }
header h1 { font-size: 16px; margin: 0; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
header .brand { color: var(--muted); font-size: 13px; }
#done { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 7px 16px;
  font-size: 14px; font-weight: 600; cursor: pointer; }
main { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 0; }
#report { padding: 20px 28px 80px; max-width: 980px; }
.tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
.tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 14px;
  font-size: 14px; color: var(--muted); cursor: pointer; }
.tab.active { color: var(--fg); border-bottom-color: var(--accent); font-weight: 600; }
.panel { display: none; } .panel.active { display: block; }
.summary { padding: 12px 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; }
section { margin-top: 28px; }
h2 { font-size: 17px; margin: 0 0 8px; }
.prose p { margin: 8px 0; }
code { background: var(--panel); border: 1px solid var(--border); border-radius: 4px;
  padding: 1px 4px; font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
.notes { margin: 8px 0; padding-left: 20px; } .notes li { margin: 4px 0; }
.hunk { margin: 14px 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.hunk-head { display: flex; gap: 12px; padding: 6px 12px; background: var(--panel);
  border-bottom: 1px solid var(--border); font: 12px ui-monospace, Menlo, monospace; }
.hunk-head .path { font-weight: 600; } .hunk-head .hh { color: var(--muted); }
.diff { width: 100%; border-collapse: collapse; font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.diff td { padding: 0 8px; white-space: pre-wrap; word-break: break-all; vertical-align: top; }
.diff .g { width: 1%; min-width: 34px; text-align: right; color: var(--muted); user-select: none; }
.diff .m { width: 1%; user-select: none; color: var(--muted); }
.diff tr.add td { background: var(--add-bg); } .diff tr.del td { background: var(--del-bg); }
.diff .c { position: relative; padding-left: 26px; }
.lc { position: absolute; left: 2px; top: 1px; width: 18px; height: 18px; border-radius: 4px; border: 0;
  background: var(--accent); color: #fff; font-size: 12px; line-height: 1; cursor: pointer;
  opacity: 0; transition: opacity .1s; padding: 0; }
tr:hover .lc { opacity: 1; }
.missing { color: var(--muted); font-style: italic; }
aside { border-left: 1px solid var(--border); padding: 16px; position: sticky; top: 49px;
  height: calc(100vh - 49px); overflow-y: auto; }
aside h3 { margin: 0 0 10px; font-size: 14px; }
.comment-card { border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin-bottom: 10px; font-size: 13px; }
.comment-card .ref { color: var(--muted); font: 11px ui-monospace, Menlo, monospace; word-break: break-all; }
.comment-card blockquote { margin: 6px 0; padding: 4px 8px; border-left: 3px solid var(--border);
  color: var(--muted); font: 11.5px ui-monospace, Menlo, monospace; white-space: pre-wrap; word-break: break-all;
  max-height: 72px; overflow: hidden; }
.comment-card .del-c { float: right; background: none; border: 0; color: var(--muted); cursor: pointer; }
#overall { width: 100%; min-height: 70px; margin-top: 8px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg); color: var(--fg); padding: 8px; font: inherit; font-size: 13px; resize: vertical; }
#empty { color: var(--muted); font-size: 13px; }
#bubble { position: absolute; display: none; z-index: 10; background: var(--accent); color: #fff; border: 0;
  border-radius: 6px; padding: 5px 10px; font-size: 13px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
#composer { position: fixed; display: none; z-index: 20; right: 340px; bottom: 20px; width: 380px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 12px;
  box-shadow: 0 8px 30px rgba(0,0,0,.25); }
#composer .ref { color: var(--muted); font: 11px ui-monospace, Menlo, monospace; margin-bottom: 6px; word-break: break-all; }
#composer blockquote { margin: 0 0 8px; padding: 4px 8px; border-left: 3px solid var(--accent);
  font: 11.5px ui-monospace, Menlo, monospace; white-space: pre-wrap; word-break: break-all; max-height: 90px; overflow: auto; }
#composer textarea { width: 100%; min-height: 80px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg); color: var(--fg); padding: 8px; font: inherit; font-size: 13px; resize: vertical; }
#composer .row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
#composer button { border-radius: 6px; padding: 5px 12px; font-size: 13px; cursor: pointer; }
#composer .save { background: var(--accent); color: #fff; border: 0; }
#composer .cancel { background: none; border: 1px solid var(--border); color: var(--fg); }
#finished { display: none; padding: 80px 20px; text-align: center; }
</style>
</head>
<body>
<header>
  <span class="brand">semrev</span>
  <h1>${esc(title)}</h1>
  <button id="done">Done</button>
</header>
<main>
  <div id="report">
    ${results.length > 1 ? `<div class="tabs">${tabs}</div>` : ""}
    ${panels}
  </div>
  <aside>
    <h3>Comments</h3>
    <div id="comments"><p id="empty">Select any text or hover a line and hit ＋ to comment.</p></div>
    <h3>Overall</h3>
    <textarea id="overall" placeholder="Optional overall feedback…"></textarea>
  </aside>
</main>
<button id="bubble">💬 Comment</button>
<div id="composer">
  <div class="ref"></div>
  <blockquote></blockquote>
  <textarea placeholder="Write a comment… (⌘⏎ to save)"></textarea>
  <div class="row"><button class="cancel">Cancel</button><button class="save">Save</button></div>
</div>
<div id="finished"><h2>Review sent ✓</h2><p>Feedback was delivered back to the agent. You can close this tab.</p></div>
<script>
const comments = [];
const $ = (s, el) => (el || document).querySelector(s);
const multiTab = ${results.length > 1 ? "true" : "false"};

// Tabs
document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === tab));
  document.querySelectorAll(".panel").forEach(p =>
    p.classList.toggle("active", p.dataset.panel === tab.dataset.tab));
}));

function currentBackend() {
  const panel = $(".panel.active");
  return panel ? panel.dataset.backend : "";
}

// Comment composer
const composer = $("#composer");
let pending = null;
function openComposer(ref, quote) {
  pending = { ref, quote, backend: currentBackend() };
  $(".ref", composer).textContent = ref;
  $("blockquote", composer).textContent = quote || "";
  $("blockquote", composer).style.display = quote ? "" : "none";
  $("textarea", composer).value = "";
  composer.style.display = "block";
  $("textarea", composer).focus();
}
function closeComposer() { composer.style.display = "none"; pending = null; }
$(".cancel", composer).addEventListener("click", closeComposer);
function saveComment() {
  const text = $("textarea", composer).value.trim();
  if (!text || !pending) return;
  comments.push({ ...pending, text });
  closeComposer();
  renderComments();
}
$(".save", composer).addEventListener("click", saveComment);
$("textarea", composer).addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveComment();
  if (e.key === "Escape") closeComposer();
});

function renderComments() {
  const box = $("#comments");
  if (!comments.length) { box.innerHTML = '<p id="empty">Select any text or hover a line and hit ＋ to comment.</p>'; return; }
  box.innerHTML = "";
  comments.forEach((c, i) => {
    const card = document.createElement("div");
    card.className = "comment-card";
    const ref = document.createElement("div"); ref.className = "ref";
    ref.textContent = (multiTab && c.backend ? "[" + c.backend + "] " : "") + c.ref;
    const del = document.createElement("button"); del.className = "del-c"; del.textContent = "✕";
    del.addEventListener("click", () => { comments.splice(i, 1); renderComments(); });
    card.append(del, ref);
    if (c.quote) { const q = document.createElement("blockquote"); q.textContent = c.quote; card.append(q); }
    const body = document.createElement("div"); body.textContent = c.text; card.append(body);
    box.append(card);
  });
}

// Line comments
document.querySelectorAll(".lc").forEach(btn => btn.addEventListener("click", e => {
  e.stopPropagation();
  const tr = btn.closest("tr");
  openComposer(tr.dataset.ref, tr.querySelector(".c").textContent.replace(/^＋/, ""));
}));

// Selection comments
const bubble = $("#bubble");
document.addEventListener("mouseup", e => {
  if (composer.contains(e.target) || bubble.contains(e.target)) return;
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) { bubble.style.display = "none"; return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    bubble.style.display = "block";
    bubble.style.left = Math.max(8, rect.left + window.scrollX) + "px";
    bubble.style.top = (rect.bottom + window.scrollY + 6) + "px";
  }, 0);
});
bubble.addEventListener("click", () => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  const quote = sel.toString().trim();
  let node = sel.anchorNode;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const tr = node && node.closest ? node.closest("tr[data-ref]") : null;
  const section = node && node.closest ? node.closest("[data-ctx]") : null;
  const ref = tr ? tr.dataset.ref : section ? "§ " + section.dataset.ctx : "report";
  bubble.style.display = "none";
  sel.removeAllRanges();
  openComposer(ref, quote);
});

// Done
$("#done").addEventListener("click", async () => {
  const payload = { comments, overall: $("#overall").value.trim() };
  await fetch("/done", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  $("main").style.display = "none";
  $("#finished").style.display = "block";
});
</script>
</body>
</html>`;
}
