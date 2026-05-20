// Spec 62.0a Section 8.4.3 (D10): claude-sonnet-4-6 rejects assistant prefill in batch mode,
// so the model wraps JSON in ```json ... ``` fences. Steps that JSON.parse(ctx.batchResult.content)
// must slice from the first '{' to the last '}' before parsing.
//
// This test pins the slicing logic that OutlineStep uses in its batch-resume branch
// (`src/article/steps/outline.ts:209-218`). Other steps with batch resume must follow the
// same pattern.
import { describe, expect, it } from "bun:test";

/** Mirror of OutlineStep's fence-tolerant slice (`src/article/steps/outline.ts:214-216`). */
function sliceJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

describe("fence-tolerant JSON parsing for batch resume (Spec 62.0a D10)", () => {
  it("parses a fenced ```json block", () => {
    const wrapped = '```json\n{"outline": ["a", "b"]}\n```';
    const sliced = sliceJsonObject(wrapped);
    const parsed = JSON.parse(sliced) as { outline: string[] };
    expect(parsed.outline).toEqual(["a", "b"]);
  });

  it("parses a fenced block with no language tag", () => {
    const wrapped = '```\n{"outline": ["a"]}\n```';
    expect(JSON.parse(sliceJsonObject(wrapped))).toEqual({ outline: ["a"] });
  });

  it("parses raw JSON without fences (unchanged)", () => {
    const raw = '{"outline": ["x", "y"]}';
    expect(JSON.parse(sliceJsonObject(raw))).toEqual({ outline: ["x", "y"] });
  });

  it("parses raw JSON with leading whitespace + comments removed by slice", () => {
    const raw = '   prelude\n{"k": 1}   ';
    expect(JSON.parse(sliceJsonObject(raw))).toEqual({ k: 1 });
  });

  it("parses a JSON object with nested braces correctly (lastIndexOf wins)", () => {
    const raw = '```json\n{"outer": {"inner": 1}}\n```';
    expect(JSON.parse(sliceJsonObject(raw))).toEqual({ outer: { inner: 1 } });
  });

  it("returns the original raw string when no curly braces are present (caller throws on parse)", () => {
    const raw = "no JSON at all";
    expect(sliceJsonObject(raw)).toBe(raw);
    expect(() => JSON.parse(sliceJsonObject(raw))).toThrow();
  });
});
