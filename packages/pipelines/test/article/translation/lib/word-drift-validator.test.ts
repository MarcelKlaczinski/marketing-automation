// Spec 64.5 — unit tests for word-drift validator helpers.
import { describe, expect, it } from "bun:test";
import {
  countBodyWords,
  maxTargetWordsFor,
  validateWordDriftCap,
} from "../../../../src/article/translation/lib/word-drift-validator.ts";

describe("countBodyWords", () => {
  it("counts words in plain text", () => {
    expect(countBodyWords("Hello world test")).toBe(3);
  });

  it("returns 0 for empty body", () => {
    expect(countBodyWords("")).toBe(0);
    expect(countBodyWords("   \n\n  ")).toBe(0);
  });

  it("excludes fenced code blocks", () => {
    const body = "Plain text.\n```ts\nconst x = 1;\nconst y = 2;\n```\nMore text.";
    expect(countBodyWords(body)).toBe(4);
  });

  it("excludes inline code", () => {
    expect(countBodyWords("Use `const x` for variables")).toBe(3);
  });

  it("strips markdown link URLs but keeps link text", () => {
    expect(countBodyWords("See [the docs](https://example.com/docs) here")).toBe(4);
  });

  it("drops markdown images entirely", () => {
    expect(countBodyWords("Hero ![alt text here](https://img/url.png) caption")).toBe(2);
  });

  it("strips markdown syntax markers (headings, bold, italic)", () => {
    expect(countBodyWords("**Bold** and *italic* text")).toBe(4);
    expect(countBodyWords("# Heading\n## Sub\nText here")).toBe(4);
  });

  it("excludes YAML front-matter", () => {
    const body = "---\ntitle: Test\nauthor: Marcel\n---\nActual content here.";
    expect(countBodyWords(body)).toBe(3);
  });

  it("strips HTML/JSX tags but keeps inner text", () => {
    expect(countBodyWords("<div>inner text here</div> outside")).toBe(4);
  });
});

describe("validateWordDriftCap", () => {
  it("returns valid when target equals source", () => {
    // 10 words each
    const source = "Das ist ein Test mit zehn Wörtern in deutscher Sprache.";
    const target = "This is a test with ten words in English language.";
    const result = validateWordDriftCap(source, target, 25);
    expect(result.valid).toBe(true);
    expect(result.driftPct).toBe(0);
  });

  it("returns valid when drift is +20% (within 25% cap)", () => {
    const source = "ein zwei drei vier fünf sechs sieben acht neun zehn";
    const target = "one two three four five six seven eight nine ten eleven twelve";
    const result = validateWordDriftCap(source, target, 25);
    expect(result.valid).toBe(true);
    expect(result.driftPct).toBe(20);
    expect(result.message).toMatch(/Word drift OK/);
  });

  it("returns invalid when drift exceeds cap (+50%)", () => {
    const source = "eins zwei drei vier fünf sechs sieben acht neun zehn";
    const target = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen";
    const result = validateWordDriftCap(source, target, 25);
    expect(result.valid).toBe(false);
    expect(result.driftPct).toBe(50);
    expect(result.message).toMatch(/exceeded.*\+50%.*cap 25%/);
  });

  it("allows arbitrarily short target (no lower bound)", () => {
    const source = "ein langer deutscher Satz mit vielen vielen Wörtern hier drin total";
    const target = "Short.";
    const result = validateWordDriftCap(source, target, 25);
    expect(result.valid).toBe(true);
    expect(result.driftPct).toBeLessThan(0);
  });

  it("handles empty source gracefully (no divide-by-zero)", () => {
    const result = validateWordDriftCap("", "Some target text", 25);
    expect(result.valid).toBe(true);
    expect(result.driftPct).toBe(0);
    expect(result.message).toMatch(/no words.*skipped/);
  });

  it("respects custom capPct", () => {
    const source = "eins zwei drei vier fünf";
    const target = "one two three four five six seven";
    expect(validateWordDriftCap(source, target, 25).valid).toBe(false);
    expect(validateWordDriftCap(source, target, 50).valid).toBe(true);
  });

  it("reports +0% when target equals source exactly", () => {
    const result = validateWordDriftCap("one two three", "ein zwei drei", 25);
    expect(result.driftPct).toBe(0);
    expect(result.message).toMatch(/Word drift OK: 3→3 \(0%, cap 25%\)/);
  });
});

describe("maxTargetWordsFor", () => {
  it("floors source × (1 + cap/100)", () => {
    expect(maxTargetWordsFor(100, 25)).toBe(125);
    expect(maxTargetWordsFor(10, 25)).toBe(12);
    expect(maxTargetWordsFor(7, 25)).toBe(8);
  });

  it("uses default cap of 25", () => {
    expect(maxTargetWordsFor(100)).toBe(125);
  });
});
