import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { configuredBackends, loadConfig } from "../src/config";

describe("config", () => {
  test("a missing config is empty", async () => {
    expect(await loadConfig(join(tmpdir(), `semantic-review-missing-${Date.now()}`))).toEqual({});
  });

  test("loads user defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "semantic-review-"));
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify({ backend: "codex", model: "gpt-test", effort: "high" }));
    expect(await loadConfig(path)).toEqual({ backend: "codex", model: "gpt-test", effort: "high" });
    expect(configuredBackends("anthropic, openai")).toEqual(["anthropic", "openai"]);
  });

  test("rejects unknown settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "semantic-review-"));
    const path = join(dir, "config.json");
    await writeFile(path, JSON.stringify({ provider: "codex" }));
    expect(loadConfig(path)).rejects.toThrow('unknown setting "provider"');
  });
});
