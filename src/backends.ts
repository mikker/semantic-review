import { z } from "zod";
import { AnalysisSchema, analysisPrompt, extractAnalysis, type Analysis, type AnalysisResult } from "./analysis";
import type { Effort } from "./config";
import { run } from "./proc";

export interface AnalyzeOpts {
  model?: string; // passed through to the backend; each CLI has its own model names
  effort?: Effort;
}

export interface Backend {
  name: string;
  available(): Promise<boolean>;
  analyze(annotatedDiff: string, opts: AnalyzeOpts): Promise<Analysis>;
}

const { $schema: _schemaVersion, ...analysisJsonSchema } = z.toJSONSchema(AnalysisSchema);

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
      detail = parsed.error?.message || parsed.message || text;
    } catch {
      // Keep the response body as the error detail.
    }
    throw new Error(`HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`API returned invalid JSON: ${text.slice(0, 500)}`);
  }
}

function haveCommand(cmd: string): Promise<boolean> {
  return run(["sh", "-c", `command -v ${cmd}`]).then(
    ({ code }) => code === 0,
    () => false,
  );
}

// Agent CLIs run in non-interactive mode with the prompt on stdin and are
// asked to print JSON only. They use whatever auth the user already has.
// argv is built per call so --model can map to each CLI's own flag.
function cliBackend(name: string, argv: (opts: AnalyzeOpts) => string[]): Backend {
  return {
    name,
    available: () => haveCommand(argv({})[0]),
    async analyze(annotatedDiff, opts) {
      const { stdout, stderr, code } = await run(argv(opts), analysisPrompt(annotatedDiff));
      if (code !== 0) throw new Error(`${name} exited ${code}: ${stderr.slice(0, 500)}`);
      return extractAnalysis(stdout);
    },
  };
}

const anthropicBackend: Backend = {
  name: "anthropic",
  available: async () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  async analyze(annotatedDiff, opts) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    if (!apiKey && !authToken) throw new Error("ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is required");
    const response = (await postJson("https://api.anthropic.com/v1/messages", {
      "anthropic-version": "2023-06-01",
      ...(apiKey ? { "x-api-key": apiKey } : { Authorization: `Bearer ${authToken}` }),
    }, {
      model: opts.model || process.env.SEMANTIC_REVIEW_MODEL || "claude-opus-5",
      max_tokens: 32000,
      output_config: {
        format: { type: "json_schema", schema: analysisJsonSchema },
        ...(opts.effort ? { effort: opts.effort } : {}),
      },
      messages: [{ role: "user", content: analysisPrompt(annotatedDiff) }],
    })) as { content?: { type: string; text?: string }[]; stop_reason?: string };
    const text = response.content?.find((block) => block.type === "text")?.text;
    if (!text) throw new Error(`no text in response (stop_reason: ${response.stop_reason ?? "unknown"})`);
    return AnalysisSchema.parse(JSON.parse(text));
  },
};

const openaiBackend: Backend = {
  name: "openai",
  available: async () => !!process.env.OPENAI_API_KEY,
  async analyze(annotatedDiff, opts) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
    const response = (await postJson("https://api.openai.com/v1/responses", {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    }, {
      model: opts.model || process.env.SEMANTIC_REVIEW_MODEL || "gpt-5.6",
      input: analysisPrompt(annotatedDiff),
      text: {
        format: { type: "json_schema", name: "semantic_review", schema: analysisJsonSchema, strict: true },
      },
    })) as { output?: { type: string; content?: { type: string; text?: string }[] }[] };
    const text = response.output
      ?.find((item) => item.type === "message")
      ?.content?.find((item) => item.type === "output_text")?.text;
    if (!text) throw new Error("no text in response");
    return AnalysisSchema.parse(JSON.parse(text));
  },
};

const novitaBackend: Backend = {
  name: "novita",
  available: async () => !!process.env.NOVITA_API_KEY,
  async analyze(annotatedDiff, opts) {
    if (!process.env.NOVITA_API_KEY) throw new Error("NOVITA_API_KEY is required");
    const response = (await postJson("https://api.novita.ai/openai/v1/chat/completions", {
      Authorization: `Bearer ${process.env.NOVITA_API_KEY}`,
    }, {
      model: opts.model || process.env.SEMANTIC_REVIEW_MODEL || "deepseek/deepseek-v3.2",
      messages: [{ role: "user", content: analysisPrompt(annotatedDiff) }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "semantic_review", schema: analysisJsonSchema },
      },
    })) as { choices?: { message?: { content?: string } }[] };
    const text = response.choices?.[0]?.message?.content;
    if (!text) throw new Error("no content in response");
    return AnalysisSchema.parse(JSON.parse(text));
  },
};

const modelFlag = (o: AnalyzeOpts, flag = "--model") => (o.model ? [flag, o.model] : []);

export const BACKENDS: Record<string, Backend> = {
  anthropic: anthropicBackend,
  openai: openaiBackend,
  novita: novitaBackend,
  claude: cliBackend("claude", (o) => ["claude", "-p", ...modelFlag(o)]),
  codex: cliBackend("codex", (o) => ["codex", "exec", "--skip-git-repo-check", ...modelFlag(o, "-m"), "-"]),
  gemini: cliBackend("gemini", (o) => ["gemini", ...modelFlag(o)]),
  pi: cliBackend("pi", (o) => ["pi", "-p", "--no-session", "--no-tools", ...modelFlag(o)]),
};

export async function resolveBackends(requested: string[] | null): Promise<Backend[]> {
  if (requested && requested.length > 0) {
    return requested.map((name) => {
      const backend = BACKENDS[name];
      if (!backend) throw new Error(`unknown backend "${name}" (known: ${Object.keys(BACKENDS).join(", ")})`);
      return backend;
    });
  }
  // Auto-detect: prefer direct APIs, then installed agent CLIs.
  for (const backend of Object.values(BACKENDS)) {
    if (await backend.available()) return [backend];
  }
  throw new Error(
    "no backend available: set ANTHROPIC_API_KEY, OPENAI_API_KEY, or NOVITA_API_KEY, or install one of: claude, codex, gemini, pi (or pass --with)",
  );
}

export async function runBackends(
  backends: Backend[],
  annotatedDiff: string,
  opts: AnalyzeOpts = {},
): Promise<AnalysisResult[]> {
  const settled = await Promise.allSettled(
    backends.map(async (b) => ({ backend: b.name, analysis: await b.analyze(annotatedDiff, opts) })),
  );
  const results: AnalysisResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") results.push(s.value);
    else console.error(`semantic-review: backend ${backends[i].name} failed: ${s.reason?.message ?? s.reason}`);
  }
  if (results.length === 0) throw new Error("all backends failed");
  return results;
}
