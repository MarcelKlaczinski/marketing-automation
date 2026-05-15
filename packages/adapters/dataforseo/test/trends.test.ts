import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { db, eq, projects } from "@marketing-auto/db";
import { computeGrowthRatio, trendsExplore } from "../src/trends.ts";
import { DataForSeoError } from "../src/types.ts";

// ─── Pure unit tests: computeGrowthRatio ─────────────────────────────────────
// These exercise only internal math — no DB, no fetch.

describe("computeGrowthRatio (pure)", () => {
  it("computes positive growth correctly", () => {
    const result = computeGrowthRatio([
      { year: 2026, month: 4, search_volume: 1200 },
      { year: 2025, month: 4, search_volume: 800 },
    ]);
    expect(result.current_volume).toBe(1200);
    expect(result.prev_year_volume).toBe(800);
    // (1200 - 800) / 800 = 0.5
    expect(result.growth_ratio).toBeCloseTo(0.5, 5);
  });

  it("computes negative growth correctly", () => {
    const result = computeGrowthRatio([
      { year: 2026, month: 4, search_volume: 600 },
      { year: 2025, month: 4, search_volume: 1000 },
    ]);
    expect(result.growth_ratio).toBeCloseTo(-0.4, 5);
  });

  it("returns null growth_ratio when prev_year_volume is 0", () => {
    const result = computeGrowthRatio([
      { year: 2026, month: 4, search_volume: 500 },
      { year: 2025, month: 4, search_volume: 0 },
    ]);
    expect(result.growth_ratio).toBeNull();
    expect(result.current_volume).toBe(500);
  });

  it("returns null growth_ratio when prev_year month is missing", () => {
    const result = computeGrowthRatio([
      { year: 2026, month: 4, search_volume: 500 },
      { year: 2025, month: 3, search_volume: 400 }, // different month — no match
    ]);
    expect(result.growth_ratio).toBeNull();
    expect(result.prev_year_volume).toBeNull();
  });

  it("returns all nulls for empty months array", () => {
    const result = computeGrowthRatio([]);
    expect(result.current_volume).toBeNull();
    expect(result.prev_year_volume).toBeNull();
    expect(result.growth_ratio).toBeNull();
  });

  it("returns all nulls for undefined months", () => {
    const result = computeGrowthRatio(undefined);
    expect(result.current_volume).toBeNull();
    expect(result.growth_ratio).toBeNull();
  });

  it("handles null search_volume in months gracefully", () => {
    const result = computeGrowthRatio([
      { year: 2026, month: 4, search_volume: null },
      { year: 2025, month: 4, search_volume: null },
    ]);
    // current_volume = null → growth_ratio must be null
    expect(result.current_volume).toBeNull();
    expect(result.growth_ratio).toBeNull();
  });

  it("picks the most recent month as current (not insertion order)", () => {
    // Months listed oldest-first — function must sort
    const result = computeGrowthRatio([
      { year: 2025, month: 4, search_volume: 800 },
      { year: 2026, month: 3, search_volume: 950 },
      { year: 2026, month: 4, search_volume: 1200 },
    ]);
    expect(result.current_volume).toBe(1200);
    expect(result.prev_year_volume).toBe(800);
  });
});

// ─── Integration tests: trendsExplore (DB-backed, mocked fetch) ──────────────

describe("trendsExplore (integration, mocked fetch)", () => {
  let projectId: string;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    const slug = `trends-test-${Date.now()}`;
    const [p] = await db
      .insert(projects)
      .values({
        slug,
        name: "Trends Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
        costLimits: {
          daily: { dataforseo: 1.0 },
          monthly: { dataforseo: 10 },
        },
      })
      .returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  function mockFetch(body: unknown, status = 200) {
    // Cast justified: Bun's mock() return doesn't include `preconnect`; runtime is fine
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        })
      )
    ) as unknown as typeof fetch;
  }

  it("returns growth data for a keyword with full monthly history", async () => {
    mockFetch({
      status_code: 20000,
      tasks: [{
        status_code: 20000,
        cost: 0.011,
        result: [{
          keyword: "ki-tools",
          months: [
            { year: 2026, month: 4, search_volume: 1200 },
            { year: 2025, month: 4, search_volume: 800 },
          ],
        }],
      }],
    });

    const result = await trendsExplore({
      projectId,
      operation: "test-trends",
      keywords: ["ki-tools"],
      estimatedCostEur: 0.011,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.growth_ratio).toBeCloseTo(0.5, 5);
  });

  it("returns null fields for a keyword missing from API response", async () => {
    mockFetch({
      status_code: 20000,
      tasks: [{ status_code: 20000, cost: 0.011, result: [] }],
    });

    const result = await trendsExplore({
      projectId,
      operation: "test-trends-miss",
      keywords: ["missing-keyword"],
      estimatedCostEur: 0.011,
    });

    expect(result[0]!.current_volume).toBeNull();
    expect(result[0]!.growth_ratio).toBeNull();
  });

  it("throws DataForSeoError on HTTP 401", async () => {
    mockFetch("Unauthorized", 401);

    await expect(
      trendsExplore({
        projectId,
        operation: "test-trends-err",
        keywords: ["ki-tools"],
        estimatedCostEur: 0.011,
      })
    ).rejects.toBeInstanceOf(DataForSeoError);
  });

  it("throws DataForSeoError when task status_code != 20000", async () => {
    mockFetch({
      status_code: 20000,
      tasks: [{ status_code: 40501, status_message: "Task not found" }],
    });

    await expect(
      trendsExplore({
        projectId,
        operation: "test-trends-task-err",
        keywords: ["ki-tools"],
        estimatedCostEur: 0.011,
      })
    ).rejects.toBeInstanceOf(DataForSeoError);
  });

  it("returns empty array immediately for empty keyword list (no fetch called)", async () => {
    const fetchSpy = mock(() => Promise.resolve(new Response("{}", { status: 200 })));
    // Cast justified: mock() doesn't include `preconnect`; runtime behaviour is correct
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await trendsExplore({
      projectId,
      operation: "test-trends-empty",
      keywords: [],
      estimatedCostEur: 0.011,
    });

    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws when more than 5 keywords provided", async () => {
    await expect(
      trendsExplore({
        projectId,
        operation: "test-trends-overflow",
        keywords: ["a", "b", "c", "d", "e", "f"],
        estimatedCostEur: 0.011,
      })
    ).rejects.toBeInstanceOf(DataForSeoError);
  });
});

// ─── Live tests ───────────────────────────────────────────────────────────────

const live = process.env.RUN_LIVE_DATAFORSEO === "1";

describe.skipIf(!live)("trendsExplore (LIVE)", () => {
  let projectId: string;

  beforeAll(async () => {
    const slug = `trends-live-${Date.now()}`;
    const [p] = await db
      .insert(projects)
      .values({
        slug,
        name: "Trends Live Test",
        industry: "ai_education",
        pipelineTemplate: "educational",
        costLimits: { daily: { dataforseo: 1.0 }, monthly: { dataforseo: 10 } },
      })
      .returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("fetches real growth data for a German AI keyword", async () => {
    const result = await trendsExplore({
      projectId,
      operation: "live-trends-test",
      keywords: ["ChatGPT"],
      estimatedCostEur: 0.015,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.keyword).toBe("ChatGPT");
    expect(result[0]!.current_volume).not.toBeNull();
  });
});
