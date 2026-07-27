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

const CARD = "rounded-lg border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900";

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

  return `<div class="hunk ${CARD} my-3 overflow-hidden">
    <div class="flex gap-3 border-b border-stone-200 bg-stone-100 px-3 py-1.5 font-mono text-xs dark:border-stone-800 dark:bg-stone-950/60">
      <span class="font-semibold">${esc(file.path)}</span>
      <span class="uppercase tracking-wider text-stone-400">${elided ? "excerpt" : ""}</span>
      <span class="text-stone-400">${esc(hunk.header)}</span>
    </div>
    <table class="diff"><tbody>${rows.join("")}</tbody></table>
  </div>`;
}

export async function renderReport(results: AnalysisResult[], files: DiffFile[]): Promise<string> {
  const langs = [...new Set(files.map((f) => langFor(f.path)).filter((l) => l !== "text"))];
  const hl = await createHighlighter({ themes: ["github-light", "github-dark"], langs });
  const hunks = hunkById(files);
  const anyDiagram = results.some(
    (r) => r.analysis.diagram.trim() || r.analysis.sections.some((s) => s.diagram.trim()),
  );
  const diagramCard = (source: string) =>
    source.trim() ? `<div class="${CARD} my-4 p-4"><pre class="mermaid">${esc(source)}</pre></div>` : "";

  const agentOptions = results
    .map((r, i) => `<option value="${i}">${esc(r.backend)}</option>`)
    .join("");

  const panels = results
    .map((r, i) => {
      const toc = r.analysis.sections
        .map((s, si) => `<a class="text-indigo-600 hover:underline dark:text-indigo-400" href="#p${i}s${si}">${esc(s.heading)}</a>`)
        .join("");
      const sections = r.analysis.sections
        .map((s, si) => {
          const snippets = s.snippets
            .map((sn) => {
              const found = hunks.get(sn.hunk_id);
              if (!found) return `<p class="text-sm italic text-stone-400">unknown hunk ${esc(sn.hunk_id)}</p>`;
              const range = sn.from != null && sn.to != null ? { from: sn.from, to: sn.to } : null;
              const note = sn.note.trim()
                ? `<p class="note mb-4 text-[13.5px] text-stone-500 dark:text-stone-400">${esc(sn.note).replace(/`([^`]+)`/g, "<code>$1</code>")}</p>`
                : "";
              return renderHunk(hl, found.file, found.hunk, range) + note;
            })
            .join("");
          return `<section id="p${i}s${si}" data-ctx="${esc(s.heading)}" class="mt-10">
            <h2 class="font-serif text-xl">${esc(s.heading)}</h2>
            <div class="prose-x">${prose(s.intro)}</div>
            ${diagramCard(s.diagram)}
            ${snippets}
          </section>`;
        })
        .join("");
      const notes = r.analysis.notes.length
        ? `<section data-ctx="Agent's notes" class="agent-notes mt-10">
            <div class="flex items-baseline justify-between gap-4">
              <h2 class="font-serif text-xl">Agent&#8217;s notes</h2>
              <label class="flex cursor-pointer items-center gap-1.5 text-sm text-stone-500 dark:text-stone-400">
                <input type="checkbox" class="include-notes accent-indigo-600"> Include in review
              </label>
            </div>
            <ul class="mt-2 list-disc space-y-1 pl-5">${r.analysis.notes
              .map((n) => `<li>${esc(n).replace(/`([^`]+)`/g, "<code>$1</code>")}</li>`)
              .join("")}</ul>
          </section>`
        : "";
      return `<div class="panel${i === 0 ? " active" : ""}" data-panel="${i}" data-backend="${esc(r.backend)}">
        <div class="tldr ${CARD} p-5" data-ctx="TL;DR">
          <span class="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">TL;DR</span>
          <div class="prose-x">${prose(r.analysis.summary)}</div>
          ${r.analysis.sections.length > 1 ? `<nav class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">${toc}</nav>` : ""}
        </div>
        ${diagramCard(r.analysis.diagram)}
        ${sections}${notes}
      </div>`;
    })
    .join("");

  // Full diff tier: every file, every hunk, collapsed per file. Shared across agents.
  const fullDiff = files
    .map((file) => {
      const adds = file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "add").length, 0);
      const dels = file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "del").length, 0);
      const body =
        file.status === "binary"
          ? `<p class="text-sm italic text-stone-400">binary file</p>`
          : file.hunks.map((h) => renderHunk(hl, file, h)).join("");
      return `<details class="my-2" data-ctx="Full diff: ${esc(file.path)}">
        <summary class="${CARD} flex cursor-pointer items-baseline gap-3 px-3 py-2">
          <span class="flex-1 font-mono text-sm font-semibold">${esc(file.path)}</span>
          <span class="text-xs text-stone-500">
            <b class="font-semibold text-emerald-600 dark:text-emerald-400">+${adds}</b>
            <b class="font-semibold text-red-600 dark:text-red-400">−${dels}</b>${
              file.status !== "modified" ? ` · ${file.status}` : ""
            }</span>
        </summary>
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
<script src="https://cdn.tailwindcss.com"></script>
<style>
/* Custom layer for what Tailwind doesn't cover cleanly: diff tables, shiki
   dual themes, brevity-level visibility, and the dynamic comment UI. */
:root { --add-bg: #dafbe1; --del-bg: #ffebe9; color-scheme: light dark; }
@media (prefers-color-scheme: dark) {
  :root { --add-bg: #12261e; --del-bg: #2d1214; }
  .diff span[style] { color: var(--shiki-dark, inherit) !important; }
}
.prose-x p { margin: 6px 0; }
code { background: rgb(245 245 244 / .8); border: 1px solid rgb(214 211 209); border-radius: 4px;
  padding: 1px 4px; font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
@media (prefers-color-scheme: dark) { code { background: rgb(28 25 23); border-color: rgb(41 37 36); } }
.panel { display: none; } .panel.active { display: block; }
/* Brevity levels: tldr = summary + notes; walk = + sections; full = full diff only */
body.level-tldr section { display: none; }
body.level-tldr section[data-ctx="Agent's notes"] { display: block; }
body.level-tldr #fulldiff, body.level-walk #fulldiff { display: none; }
body.level-full .panel.active, body.level-full #agent { display: none; }
.levels button.active { background: rgb(231 229 228); color: inherit; font-weight: 600; }
@media (prefers-color-scheme: dark) { .levels button.active { background: rgb(41 37 36); } }
.diff { width: 100%; border-collapse: collapse; font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.diff td { padding: 0 8px; white-space: pre-wrap; word-break: break-all; vertical-align: top; }
.diff .g { width: 1%; min-width: 34px; text-align: right; color: rgb(168 162 158); user-select: none;
  white-space: nowrap; word-break: normal; }
.diff .m { width: 1%; user-select: none; color: rgb(168 162 158); }
.diff tr.add td { background: var(--add-bg); } .diff tr.del td { background: var(--del-bg); }
.diff .c { position: relative; padding-left: 26px; }
.lc { position: absolute; left: 2px; top: 1px; width: 18px; height: 18px; border-radius: 4px; border: 0;
  background: #4f46e5; color: #fff; font-size: 12px; line-height: 1; cursor: pointer;
  opacity: 0; transition: opacity .1s; padding: 0; }
tr:hover .lc { opacity: 1; }
.mermaid { display: flex; justify-content: center; }
#bubble { position: absolute; display: none; z-index: 10; background: #4f46e5; color: #fff; border: 0;
  border-radius: 6px; padding: 5px 10px; font-size: 13px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
#composer blockquote, .comment-card blockquote { margin: 6px 0 8px; padding: 4px 8px;
  border-left: 3px solid #4f46e5; font: 11.5px ui-monospace, Menlo, monospace;
  white-space: pre-wrap; word-break: break-all; max-height: 90px; overflow: auto; }
.comment-card blockquote { border-left-color: rgb(214 211 209); color: rgb(120 113 108); overflow: hidden; }
</style>
</head>
<body class="level-walk bg-stone-50 font-sans text-slate-900 dark:bg-stone-950 dark:text-stone-100">
<header class="sticky top-0 z-20 flex items-center gap-3 border-b border-stone-200 bg-stone-50/90 px-6 py-2.5 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
  <span class="text-sm text-stone-400">semrev</span>
  <h1 class="flex-1 truncate font-serif text-lg">${esc(title)}</h1>
  ${results.length > 1 ? `<select id="agent" title="Analysis by" class="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm dark:border-stone-800 dark:bg-stone-900">${agentOptions}</select>` : ""}
  <div class="levels inline-flex overflow-hidden rounded-lg border border-stone-200 text-sm text-stone-500 dark:border-stone-800 dark:text-stone-400">
    <button data-level="tldr" class="border-r border-stone-200 px-3.5 py-1.5 dark:border-stone-800">TL;DR</button>
    <button data-level="walk" class="active border-r border-stone-200 px-3.5 py-1.5 dark:border-stone-800">Walkthrough</button>
    <button data-level="full" class="px-3.5 py-1.5">Full diff</button>
  </div>
  <button id="done" class="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700">Done</button>
</header>
<main class="grid grid-cols-[minmax(0,1fr)_320px]">
  <div id="report" class="max-w-4xl px-7 pb-24 pt-6">
    ${panels}
    <div id="fulldiff" data-ctx="Full diff">
      ${fullDiff}
    </div>
  </div>
  <aside class="sticky top-[53px] h-[calc(100vh-53px)] overflow-y-auto border-l border-stone-200 p-4 dark:border-stone-800">
    <h3 class="mb-2 text-xs font-bold uppercase tracking-wider text-stone-400">Comments</h3>
    <div id="comments"><p id="empty" class="text-sm text-stone-400">Select any text or hover a line and hit ＋ to comment.</p></div>
    <h3 class="mb-2 mt-6 text-xs font-bold uppercase tracking-wider text-stone-400">Overall</h3>
    <textarea id="overall" placeholder="Optional overall feedback…" class="min-h-[70px] w-full resize-y rounded-lg border border-stone-200 bg-white p-2 text-sm dark:border-stone-800 dark:bg-stone-900"></textarea>
  </aside>
</main>
<button id="bubble">💬 Comment</button>
<div id="composer" class="fixed bottom-5 right-[340px] z-30 hidden w-[380px] rounded-xl border border-stone-200 bg-white p-3 shadow-2xl dark:border-stone-800 dark:bg-stone-900">
  <div class="ref mb-1.5 font-mono text-[11px] text-stone-400 [word-break:break-all]"></div>
  <blockquote></blockquote>
  <textarea placeholder="Write a comment… (⌘⏎ to save)" class="min-h-[80px] w-full resize-y rounded-lg border border-stone-200 bg-white p-2 text-sm dark:border-stone-700 dark:bg-stone-950"></textarea>
  <div class="mt-2 flex justify-end gap-2 text-sm">
    <button class="cancel rounded-lg border border-stone-200 px-3 py-1 dark:border-stone-700">Cancel</button>
    <button class="save rounded-lg bg-indigo-600 px-3 py-1 font-semibold text-white">Save</button>
  </div>
</div>
<div id="finished" class="hidden px-5 py-24 text-center">
  <h2 class="font-serif text-2xl">Review sent ✓</h2>
  <p class="mt-2 text-stone-500">Feedback was delivered back to the agent. You can close this tab.</p>
</div>
<script type="module">
${anyDiagram ? `import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({
  startOnLoad: false,
  theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "neutral",
  securityLevel: "loose",
});
async function renderDiagrams() {
  const nodes = [...document.querySelectorAll(".panel.active .mermaid:not([data-processed])")];
  if (nodes.length) await mermaid.run({ nodes }).catch(console.error);
}
renderDiagrams();` : `function renderDiagrams() {}`}

const comments = [];
const $ = (s, el) => (el || document).querySelector(s);
const multiTab = ${results.length > 1 ? "true" : "false"};

// Agent selector
const agentSelect = $("#agent");
if (agentSelect) agentSelect.addEventListener("change", () => {
  document.querySelectorAll(".panel").forEach(p =>
    p.classList.toggle("active", p.dataset.panel === agentSelect.value));
  renderDiagrams();
});

// Brevity levels
document.querySelectorAll(".levels button").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".levels button").forEach(b => b.classList.toggle("active", b === btn));
  document.body.className = document.body.className.replace(/level-\\w+/, "level-" + btn.dataset.level);
  renderDiagrams();
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
  if (!comments.length) { box.innerHTML = '<p id="empty" class="text-sm text-stone-400">Select any text or hover a line and hit ＋ to comment.</p>'; return; }
  box.innerHTML = "";
  comments.forEach((c, i) => {
    const card = document.createElement("div");
    card.className = "comment-card mb-2.5 rounded-lg border border-stone-200 bg-white p-2.5 text-sm dark:border-stone-800 dark:bg-stone-900";
    const ref = document.createElement("div");
    ref.className = "font-mono text-[11px] text-stone-400 [word-break:break-all]";
    ref.textContent = (multiTab && c.backend ? "[" + c.backend + "] " : "") + c.ref;
    const del = document.createElement("button");
    del.className = "float-right text-stone-400 hover:text-stone-600";
    del.textContent = "✕";
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
  const notes = [...document.querySelectorAll(".include-notes:checked")].map((cb) => {
    const panel = cb.closest(".panel");
    return {
      backend: panel.dataset.backend,
      items: [...panel.querySelectorAll(".agent-notes li")].map((li) => li.textContent.trim()),
    };
  });
  const payload = { comments, overall: $("#overall").value.trim(), notes };
  await fetch("/done", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  $("main").style.display = "none";
  $("#finished").style.display = "block";
});
</script>
</body>
</html>`;
}
