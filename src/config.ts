import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

const ConfigSchema = z
  .object({
    backend: z.union([z.string(), z.array(z.string())]).optional(),
    model: z.string().optional(),
    effort: z.enum(EFFORTS).optional(),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

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

  const parsed = ConfigSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  const issue = parsed.error.issues[0];
  const detail = issue.code === "unrecognized_keys"
    ? `unknown setting "${issue.keys[0]}"`
    : issue.path.length > 0
      ? `"${issue.path.join(".")}" ${issue.message}`
      : issue.message;
  throw new Error(`invalid config ${path}: ${detail}`);
}

export function isEffort(value: string | undefined): value is Effort {
  return EFFORTS.includes(value as Effort);
}

export function configuredBackends(backend: Config["backend"]): string[] | null {
  if (!backend) return null;
  return (Array.isArray(backend) ? backend : backend.split(",")).map((name) => name.trim()).filter(Boolean);
}
