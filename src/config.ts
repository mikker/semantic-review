import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Config {
  backend?: string | string[];
  model?: string;
  effort?: Effort;
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "semantic-review", "config.json");
}

export async function loadConfig(path = configPath()): Promise<Config> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`could not read config ${path}: ${(error as Error).message}`);
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid config ${path}: expected a JSON object`);
  }
  const config = value as Record<string, unknown>;
  const known = new Set(["backend", "model", "effort"]);
  const unknown = Object.keys(config).filter((key) => !known.has(key));
  if (unknown.length) throw new Error(`invalid config ${path}: unknown setting "${unknown[0]}"`);
  if (
    config.backend !== undefined &&
    typeof config.backend !== "string" &&
    !(Array.isArray(config.backend) && config.backend.every((item) => typeof item === "string"))
  ) {
    throw new Error(`invalid config ${path}: "backend" must be a string or array of strings`);
  }
  if (config.model !== undefined && typeof config.model !== "string") {
    throw new Error(`invalid config ${path}: "model" must be a string`);
  }
  if (
    config.effort !== undefined &&
    !["low", "medium", "high", "xhigh", "max"].includes(config.effort as string)
  ) {
    throw new Error(`invalid config ${path}: "effort" must be low, medium, high, xhigh, or max`);
  }
  return config as Config;
}

export function configuredBackends(backend: Config["backend"]): string[] | null {
  if (!backend) return null;
  return (Array.isArray(backend) ? backend : backend.split(",")).map((name) => name.trim()).filter(Boolean);
}
