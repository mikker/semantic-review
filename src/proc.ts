import { spawn } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

// Runs a command, optionally writing stdin, and collects stdout/stderr/exit code.
export function run(argv: string[], stdin?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(argv[0], argv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    proc.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    if (stdin !== undefined) proc.stdin.write(stdin);
    proc.stdin.end();
  });
}
