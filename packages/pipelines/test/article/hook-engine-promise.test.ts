import { describe, expect, it } from "bun:test";
import { buildPromiseBlock } from "../../src/article/social-image/hookEngine.ts";

describe("buildPromiseBlock — superlative_question is tool-count-aware", () => {
  it("uses 'beide' for exactly 2 tools", () => {
    const pb = buildPromiseBlock("superlative_question", { toolCount: 2, primaryKeyword: "Logos" });
    expect(pb.line1).toBe("Wir haben beide getestet.");
  });

  it("uses 'Alle N' for 3+ tools", () => {
    expect(buildPromiseBlock("superlative_question", { toolCount: 3, primaryKeyword: "Logos" }).line1)
      .toBe("Alle 3 in der Praxis getestet.");
    expect(buildPromiseBlock("superlative_question", { toolCount: 5, primaryKeyword: "Logos" }).line1)
      .toBe("Alle 5 in der Praxis getestet.");
  });

  it("preserves the original 'Eine gewinnt klar.' tagline", () => {
    expect(buildPromiseBlock("superlative_question", { toolCount: 4, primaryKeyword: "x" }).line2)
      .toBe("Eine gewinnt klar.");
  });
});
