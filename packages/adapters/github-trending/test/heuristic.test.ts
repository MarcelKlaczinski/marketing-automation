import { describe, it, expect } from "bun:test";
import { buildTrendingQueries } from "../src/heuristic.ts";

describe("buildTrendingQueries", () => {
  it("produces two queries with correct qualifier types", () => {
    const result = buildTrendingQueries({
      topics: ["ai-tools", "llm"],
      timeWindowDays: 7,
      minStarsNew: 20,
      minStarsEstablished: 500,
    });

    expect(result.newRisingQuery).toContain("created:>");
    expect(result.newRisingQuery).toContain("stars:>20");
    expect(result.activeEstablishedQuery).toContain("pushed:>");
    expect(result.activeEstablishedQuery).toContain("stars:>500");
  });

  it("includes all topics in both queries", () => {
    const result = buildTrendingQueries({
      topics: ["ai-tools", "llm", "ai-agents"],
      timeWindowDays: 7,
      minStarsNew: 20,
      minStarsEstablished: 500,
    });

    expect(result.newRisingQuery).toContain("topic:ai-tools");
    expect(result.newRisingQuery).toContain("topic:llm");
    expect(result.newRisingQuery).toContain("topic:ai-agents");
    expect(result.activeEstablishedQuery).toContain("topic:ai-tools");
  });

  it("date is YYYY-MM-DD format", () => {
    const result = buildTrendingQueries({
      topics: ["llm"],
      timeWindowDays: 7,
      minStarsNew: 20,
      minStarsEstablished: 500,
    });

    const dateMatch = result.newRisingQuery.match(/created:>(\d{4}-\d{2}-\d{2})/);
    expect(dateMatch).not.toBeNull();
  });

  it("date is approximately N days ago", () => {
    const before = Date.now();
    const result = buildTrendingQueries({
      topics: ["llm"],
      timeWindowDays: 7,
      minStarsNew: 0,
      minStarsEstablished: 0,
    });
    const after = Date.now();

    const dateMatch2 = result.newRisingQuery.match(/created:>(\d{4}-\d{2}-\d{2})/);
    const dateStr = dateMatch2?.[1] ?? "";
    const parsed = new Date(dateStr).getTime();

    const expectedMin = before - 7 * 24 * 60 * 60 * 1000;
    const expectedMax = after - 7 * 24 * 60 * 60 * 1000;
    // Allow 1-day slack for midnight boundary
    expect(parsed).toBeGreaterThanOrEqual(expectedMin - 86_400_000);
    expect(parsed).toBeLessThanOrEqual(expectedMax + 86_400_000);
  });
});
