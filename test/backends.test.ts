import { afterEach, describe, expect, test } from "bun:test";
import { BACKENDS } from "../src/backends";

const originalFetch = globalThis.fetch;
const originalOpenAIKey = process.env.OPENAI_API_KEY;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

const analysis = {
  title: "Change",
  summary: "Summary",
  diagram: "",
  sections: [],
  notes: [],
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAIKey;
  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
});

describe("API backends", () => {
  test("calls the OpenAI Responses API with a JSON schema", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let request: RequestInit | undefined;
    globalThis.fetch = (async (_url, init) => {
      request = init;
      return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(analysis) }] }] });
    }) as typeof fetch;

    expect((await BACKENDS.openai.analyze("diff", { model: "gpt-test" })).title).toBe("Change");
    const body = JSON.parse(request?.body as string);
    expect(body.model).toBe("gpt-test");
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.schema.properties.title.type).toBe("string");
  });

  test("calls the Anthropic Messages API with a JSON schema", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    let request: RequestInit | undefined;
    globalThis.fetch = (async (_url, init) => {
      request = init;
      return Response.json({ content: [{ type: "text", text: JSON.stringify(analysis) }], stop_reason: "end_turn" });
    }) as typeof fetch;

    expect((await BACKENDS.anthropic.analyze("diff", { effort: "high" })).title).toBe("Change");
    const body = JSON.parse(request?.body as string);
    expect(body.output_config.effort).toBe("high");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.properties.title.type).toBe("string");
  });
});
