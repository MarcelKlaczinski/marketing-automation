import { describe, expect, it } from "bun:test";
import { buildNicheContext } from "../../src/cold-start/_lib/niche-context.ts";

describe("buildNicheContext", () => {
  it("returns full library entry for ai-tool-wiki", () => {
    const ctx = buildNicheContext("ai-tool-wiki");
    expect(ctx.niche).toBe("ai-tool-wiki");
    expect(ctx.exampleCompetitors.international).toContain("toolify.ai");
    expect(ctx.exampleCompetitors.international).toContain("futurepedia.io");
    expect(ctx.exampleCompetitors.dach.length).toBeGreaterThan(0);
    expect(ctx.topicalKeywords.length).toBeGreaterThan(0);
    expect(ctx.contentTypes.length).toBeGreaterThan(0);
  });

  it("returns full library entry for automotive-dealer", () => {
    const ctx = buildNicheContext("automotive-dealer");
    expect(ctx.niche).toBe("automotive-dealer");
    expect(ctx.exampleCompetitors.dach).toContain("mobile.de");
    expect(ctx.topicalKeywords).toContain("Auto kaufen");
  });

  it("returns generic fallback for null", () => {
    const ctx = buildNicheContext(null);
    expect(ctx.niche).toBeNull();
    expect(ctx.exampleCompetitors.international).toHaveLength(0);
    expect(ctx.exampleCompetitors.dach).toHaveLength(0);
    expect(ctx.topicalKeywords).toHaveLength(0);
    expect(ctx.description).toContain("Generic");
  });

  it("returns generic fallback for unknown niche without crashing", () => {
    const ctx = buildNicheContext("unknown-niche-xyz");
    expect(ctx.niche).toBeNull();
    expect(ctx.description).toContain("Generic");
  });
});
