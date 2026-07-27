import { describe, expect, test } from "bun:test";
import { extractAnalysis } from "../src/analysis";

const VALID = JSON.stringify({
  title: "t",
  summary: "s",
  diagram: "",
  sections: [
    {
      heading: "h",
      intro: "i",
      diagram: "",
      snippets: [{ hunk_id: "h1", from: 2, to: 4, note: "" }],
    },
  ],
  notes: [],
});

describe("extractAnalysis", () => {
  test("parses a bare JSON object", () => {
    expect(extractAnalysis(VALID).title).toBe("t");
  });

  test("strips markdown fences", () => {
    expect(extractAnalysis("```json\n" + VALID + "\n```").title).toBe("t");
  });

  test("finds the object inside surrounding prose", () => {
    expect(extractAnalysis("Here is my analysis:\n" + VALID + "\nHope that helps!").title).toBe("t");
  });

  test("throws when there is no JSON at all", () => {
    expect(() => extractAnalysis("I cannot analyze this diff.")).toThrow("no JSON object found");
  });

  test("throws when the JSON does not match the schema", () => {
    expect(() => extractAnalysis('{"title": "t"}')).toThrow();
  });
});
