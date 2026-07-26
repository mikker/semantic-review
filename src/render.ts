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

interface LineRange {
  from: number;
  to: number;
}

// Renders a hunk (or an excerpt of it) as a highlighted, commentable diff table.
function renderHunk(hl: Highlighter, file: DiffFile, hunk: Hunk, range?: LineRange | null): string {
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

  let indices = hunk.lines.map((_, i) => i);
  if (range) {
    const within = (n: number | null) => n != null && n >= range.from && n <= range.to;
    const sliced = indices.filter((i) => within(hunk.lines[i].newNo) || within(hunk.lines[i].oldNo));
    if (sliced.length > 0) indices = sliced;
  }
  const elided = indices.length < hunk.lines.length;

  const rows = indices.map((i) => {
    const line = hunk.lines[i];
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

  return `<div class="hunk">
    <div class="hunk-head"><span class="path">${esc(file.path)}</span><span class="hh">${esc(
      elided ? `excerpt · ${hunk.header}` : hunk.header,
    )}</span></div>
    <table class="diff"><tbody>${rows.join("")}</tbody></table>
  </div>`;
}

export async function renderReport(results: AnalysisResult[], files: DiffFile[]): Promise<string> {
  const langs = [...new Set(files.map((f) => langFor(f.path)).filter((l) => l !== "text"))];
  const hl = await createHighlighter({ themes: ["github-light", "github-dark"], langs });
  const hunks = hunkById(files);

  const agentOptions = results
    .map((r, i) => `<option value="${i}">${esc(r.backend)}</option>`)
    .join("");

  const panels = results
    .map((r, i) => {
      const toc = r.analysis.sections
        .map((s, si) => `<a href="#p${i}s${si}">${esc(s.heading)}</a>`)
        .join("");
      const sections = r.analysis.sections
        .map((s, si) => {
          const snippets = s.snippets
            .map((sn) => {
              const found = hunks.get(sn.hunk_id);
              if (!found) return `<p class="missing">unknown hunk ${esc(sn.hunk_id)}</p>`;
              const range = sn.from != null && sn.to != null ? { from: sn.from, to: sn.to } : null;
              const note = sn.note.trim() ? `<p class="note">${esc(sn.note).replace(/`([^`]+)`/g, "<code>$1</code>")}</p>` : "";
              return renderHunk(hl, found.file, found.hunk, range) + note;
            })
            .join("");
          return `<section id="p${i}s${si}" data-ctx="${esc(s.heading)}">
            <h2>${esc(s.heading)}</h2>
            <div class="prose">${prose(s.intro)}</div>
            ${snippets}
          </section>`;
        })
        .join("");
      const notes = r.analysis.notes.length
        ? `<section data-ctx="Agent's notes"><h2>Agent&#8217;s notes</h2><ul class="notes">${r.analysis.notes
            .map((n) => `<li>${esc(n).replace(/`([^`]+)`/g, "<code>$1</code>")}</li>`)
            .join("")}</ul></section>`
        : "";
      return `<div class="panel${i === 0 ? " active" : ""}" data-panel="${i}" data-backend="${esc(r.backend)}">
        <div class="tldr" data-ctx="TL;DR">
          <span class="tag">TL;DR</span>
          <div class="prose">${prose(r.analysis.summary)}</div>
          ${r.analysis.sections.length > 1 ? `<nav class="toc">${toc}</nav>` : ""}
        </div>
        ${sections}${notes}
      </div>`;
    })
    .join("");

  // Full diff tier: every file, every hunk, collapsed per file. Shared across tabs.
  const fullDiff = files
    .map((file) => {
      const adds = file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "add").length, 0);
      const dels = file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "del").length, 0);
      const body =
        file.status === "binary"
          ? `<p class="missing">binary file</p>`
          : file.hunks.map((h) => renderHunk(hl, file, h)).join("");
      return `<details data-ctx="Full diff: ${esc(file.path)}">
        <summary><span class="path">${esc(file.path)}</span><span class="stat"><b class="a">+${adds}</b> <b class="d">−${dels}</b>${
          file.status !== "modified" ? ` · ${file.status}` : ""
        }</span></summary>
        ${body}
      </details>`;
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
#agent { border: 1px solid var(--border); border-radius: 8px; background: var(--panel); color: var(--fg);
  font-size: 13px; padding: 5px 8px; }
.levels { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.levels button { background: none; border: 0; border-right: 1px solid var(--border); padding: 6px 14px;
  font-size: 13px; color: var(--muted); cursor: pointer; }
.levels button:last-child { border-right: 0; }
.levels button.active { background: var(--panel); color: var(--fg); font-weight: 600; }
/* Brevity levels: tldr = summary + notes; walk = + sections; full = full diff only */
body.level-tldr section { display: none; }
body.level-tldr section[data-ctx="Agent's notes"] { display: block; }
body.level-tldr #fulldiff, body.level-walk #fulldiff { display: none; }
body.level-full .panel.active, body.level-full #agent { display: none; }
.panel { display: none; } .panel.active { display: block; }
.tldr { padding: 12px 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; }
.tldr .tag { font-size: 11px; font-weight: 700; letter-spacing: .05em; color: var(--accent); }
.tldr .prose p:first-child { margin-top: 4px; }
.toc { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; font-size: 13px; }
.toc a { color: var(--accent); text-decoration: none; }
section { margin-top: 26px; }
h2 { font-size: 17px; margin: 0 0 6px; }
.prose p { margin: 6px 0; }
.note { margin: 6px 0 14px; font-size: 13.5px; color: var(--muted); }
code { background: var(--panel); border: 1px solid var(--border); border-radius: 4px;
  padding: 1px 4px; font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
.notes { margin: 8px 0; padding-left: 20px; } .notes li { margin: 4px 0; }
.hunk { margin: 10px 0 4px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.hunk-head { display: flex; gap: 12px; padding: 5px 12px; background: var(--panel);
  border-bottom: 1px solid var(--border); font: 12px ui-monospace, Menlo, monospace; }
.hunk-head .path { font-weight: 600; } .hunk-head .hh { color: var(--muted); }
.diff { width: 100%; border-collapse: collapse; font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.diff td { padding: 0 8px; white-space: pre-wrap; word-break: break-all; vertical-align: top; }
.diff .g { width: 1%; min-width: 34px; text-align: right; color: var(--muted); user-select: none;
  white-space: nowrap; word-break: normal; }
.diff .m { width: 1%; user-select: none; color: var(--muted); }
.diff tr.add td { background: var(--add-bg); } .diff tr.del td { background: var(--del-bg); }
.diff .c { position: relative; padding-left: 26px; }
.lc { position: absolute; left: 2px; top: 1px; width: 18px; height: 18px; border-radius: 4px; border: 0;
  background: var(--accent); color: #fff; font-size: 12px; line-height: 1; cursor: pointer;
  opacity: 0; transition: opacity .1s; padding: 0; }
tr:hover .lc { opacity: 1; }
.missing { color: var(--muted); font-style: italic; }
details { margin: 8px 0; }
summary { cursor: pointer; padding: 6px 10px; background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; display: flex; gap: 12px; align-items: baseline; }
details[open] > summary { border-radius: 8px 8px 0 0; }
summary .path { font: 12.5px ui-monospace, Menlo, monospace; font-weight: 600; flex: 1; }
summary .stat { font-size: 12px; color: var(--muted); }
summary .a { color: #1a7f37; } summary .d { color: #cf222e; }
@media (prefers-color-scheme: dark) { summary .a { color: #3fb950; } summary .d { color: #f85149; } }
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
<body class="level-walk">
<header>
  <span class="brand">semrev</span>
  <h1>${esc(title)}</h1>
  ${results.length > 1 ? `<select id="agent" title="Analysis by">${agentOptions}</select>` : ""}
  <div class="levels">
    <button data-level="tldr">TL;DR</button>
    <button data-level="walk" class="active">Walkthrough</button>
    <button data-level="full">Full diff</button>
  </div>
  <button id="done">Done</button>
</header>
<main>
  <div id="report">
    ${panels}
    <div id="fulldiff" data-ctx="Full diff">
      ${fullDiff}
    </div>
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

// Agent selector
const agentSelect = $("#agent");
if (agentSelect) agentSelect.addEventListener("change", () => {
  document.querySelectorAll(".panel").forEach(p =>
    p.classList.toggle("active", p.dataset.panel === agentSelect.value));
});

// Brevity levels
document.querySelectorAll(".levels button").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".levels button").forEach(b => b.classList.toggle("active", b === btn));
  document.body.className = "level-" + btn.dataset.level;
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
