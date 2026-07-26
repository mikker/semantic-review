import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AnalysisSchema, analysisPrompt, extractAnalysis, type Analysis, type AnalysisResult } from "./analysis";

export interface Backend {
  name: string;
  available(): Promise<boolean>;
  analyze(annotatedDiff: string): Promise<Analysis>;
}

function haveCommand(cmd: string): Promise<boolean> {
  return Bun.$`command -v ${cmd}`.quiet().then(
    () => true,
    () => false,
  );
}

// Agent CLIs run in non-interactive mode with the prompt on stdin/argv and are
// asked to print JSON only. They use whatever auth the user already has.
function cliBackend(name: string, argv: string[]): Backend {
  return {
    name,
    available: () => haveCommand(argv[0]),
    async analyze(annotatedDiff) {
      const proc = Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      proc.stdin.write(analysisPrompt(annotatedDiff));
      proc.stdin.end();
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code !== 0) throw new Error(`${name} exited ${code}: ${err.slice(0, 500)}`);
      return extractAnalysis(out);
    },
  };
}

const anthropicBackend: Backend = {
  name: "anthropic",
  available: async () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  async analyze(annotatedDiff) {
    const client = new Anthropic();
    const stream = client.messages.stream({
      model: process.env.SEMREV_MODEL || "claude-opus-5",
      max_tokens: 32000,
      output_config: { format: zodOutputFormat(AnalysisSchema) },
      messages: [{ role: "user", content: analysisPrompt(annotatedDiff) }],
    });
    const message = await stream.finalMessage();
    const text = message.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error(`no text in response (stop_reason: ${message.stop_reason})`);
    return AnalysisSchema.parse(JSON.parse(text.text));
  },
};

export const BACKENDS: Record<string, Backend> = {
  anthropic: anthropicBackend,
  claude: cliBackend("claude", ["claude", "-p"]),
  codex: cliBackend("codex", ["codex", "exec", "--skip-git-repo-check", "-"]),
  gemini: cliBackend("gemini", ["gemini"]),
};

export async function resolveBackends(requested: string[] | null): Promise<Backend[]> {
  if (requested && requested.length > 0) {
    return requested.map((name) => {
      const backend = BACKENDS[name];
      if (!backend) throw new Error(`unknown backend "${name}" (known: ${Object.keys(BACKENDS).join(", ")})`);
      return backend;
    });
  }
  // Auto-detect: prefer the direct API, then installed agent CLIs.
  for (const backend of Object.values(BACKENDS)) {
    if (await backend.available()) return [backend];
  }
  throw new Error(
    "no backend available: set ANTHROPIC_API_KEY, or install one of: claude, codex, gemini (or pass --with)",
  );
}

export async function runBackends(backends: Backend[], annotatedDiff: string): Promise<AnalysisResult[]> {
  const settled = await Promise.allSettled(
    backends.map(async (b) => ({ backend: b.name, analysis: await b.analyze(annotatedDiff) })),
  );
  const results: AnalysisResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") results.push(s.value);
    else console.error(`semrev: backend ${backends[i].name} failed: ${s.reason?.message ?? s.reason}`);
  }
  if (results.length === 0) throw new Error("all backends failed");
  return results;
}
