import { describe, expect, it } from "bun:test";
import { db, eq, costLogs, pipelineRuns, projects } from "@marketing-auto/db";
import {
  BUFFER_FACTOR,
  DEFAULT_COST_BY_ITEM_TYPE,
  DEFAULT_COST_BY_PIPELINE,
  defaultCostFor,
  estimateWeeklyPlanCost,
  type EstimatorStep,
  type PlannedItem,
} from "../src/weekly-budget.ts";

const NEVER_MATCHED_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

const step = (cost: number): EstimatorStep => ({ estimatedCostEur: () => cost });

describe("defaultCostFor", () => {
  it("itemType beats pipelineName", () => {
    expect(defaultCostFor("article", "article:outline")).toBe(0.3);
    expect(DEFAULT_COST_BY_ITEM_TYPE.article).toBe(0.3);
  });
  it("falls back to pipelineName when itemType is unmapped", () => {
    expect(defaultCostFor("unknown-type", "article:schema-extension")).toBe(0.01);
    expect(DEFAULT_COST_BY_PIPELINE["article:schema-extension"]).toBe(0.01);
  });
  it("returns 0 when neither key is mapped", () => {
    expect(defaultCostFor("unknown-type", "unknown-pipeline")).toBe(0);
  });
});

describe("estimateWeeklyPlanCost", () => {
  it("tier 1: sums step.estimatedCostEur across pipeline steps", async () => {
    const plannedItems: PlannedItem[] = [
      { id: "i1", itemType: "article", pipelineName: "p1", predictedInput: {} },
    ];
    const result = await estimateWeeklyPlanCost({
      plannedItems,
      weeklyBudgetEur: 100,
      projectId: NEVER_MATCHED_PROJECT_ID,
      resolvePipelineSteps: (name) => (name === "p1" ? [step(0.1), step(0.2), step(0.05)] : undefined),
    });
    expect(result.totalEstimateEur).toBeCloseTo(0.35, 6);
    expect(result.perItemBreakdown[0]!.source).toBe("pipeline_steps");
    expect(result.bufferedEstimateEur).toBeCloseTo(0.35 * BUFFER_FACTOR, 6);
    expect(result.withinBudget).toBe(true);
    expect(result.overrunEur).toBeNull();
  });

  it("tier 3: falls through to defaults when tier 1 + 2 return zero", async () => {
    const plannedItems: PlannedItem[] = [
      { id: "i1", itemType: "article", pipelineName: "unknown:pipeline", predictedInput: {} },
      { id: "i2", itemType: "translation", pipelineName: "unknown:pipeline", predictedInput: {} },
    ];
    const result = await estimateWeeklyPlanCost({
      plannedItems,
      weeklyBudgetEur: 100,
      projectId: NEVER_MATCHED_PROJECT_ID,
      // No resolvePipelineSteps → tier 1 skipped; never-matched projectId → tier 2 empty.
    });
    const expected = 0.3 + 0.1; // DEFAULT_COST_BY_ITEM_TYPE.article + .translation
    expect(result.totalEstimateEur).toBeCloseTo(expected, 6);
    expect(result.perItemBreakdown.every((r) => r.source === "default")).toBe(true);
  });

  it("returns source='zero' when no tier can produce a non-zero estimate", async () => {
    const plannedItems: PlannedItem[] = [
      { id: "i1", itemType: "totally-unknown", pipelineName: "also-unknown", predictedInput: {} },
    ];
    const result = await estimateWeeklyPlanCost({
      plannedItems,
      weeklyBudgetEur: 100,
      projectId: NEVER_MATCHED_PROJECT_ID,
    });
    expect(result.totalEstimateEur).toBe(0);
    expect(result.perItemBreakdown[0]!.source).toBe("zero");
  });

  it("buffer is 15% above raw total", async () => {
    const plannedItems: PlannedItem[] = [
      { id: "i1", itemType: "article", pipelineName: "p1", predictedInput: {} },
    ];
    const result = await estimateWeeklyPlanCost({
      plannedItems,
      weeklyBudgetEur: 100,
      projectId: NEVER_MATCHED_PROJECT_ID,
      resolvePipelineSteps: () => [step(1.0)],
    });
    expect(result.bufferedEstimateEur).toBeCloseTo(1.15, 6);
  });

  it("flags overrun when buffered total exceeds budget", async () => {
    const plannedItems: PlannedItem[] = [
      { id: "i1", itemType: "article", pipelineName: "p1", predictedInput: {} },
    ];
    const result = await estimateWeeklyPlanCost({
      plannedItems,
      weeklyBudgetEur: 1.0,
      projectId: NEVER_MATCHED_PROJECT_ID,
      resolvePipelineSteps: () => [step(2.0)],
    });
    expect(result.withinBudget).toBe(false);
    // 2.0 * 1.15 - 1.0 = 1.3
    expect(result.overrunEur).toBeCloseTo(1.3, 6);
  });

  it("skips refresh items younger than the freshness threshold (source='skipped_recent')", async () => {
    const now = Date.now();
    const recentArticle = {
      frontmatterUpdatedAt: new Date(now - 5 * 86_400_000), // 5 days ago
      lastRefreshedAt: null,
      publishedAt: null,
      updatedAt: new Date(now),
    };
    const plannedItems: PlannedItem[] = [
      {
        id: "i1",
        itemType: "refresh",
        pipelineName: "article:refresh",
        predictedInput: {},
        refreshArticle: recentArticle,
      },
    ];
    const result = await estimateWeeklyPlanCost({
      plannedItems,
      weeklyBudgetEur: 100,
      projectId: NEVER_MATCHED_PROJECT_ID,
      resolvePipelineSteps: () => [step(0.4)], // would otherwise be 0.4
    });
    expect(result.perItemBreakdown[0]!.source).toBe("skipped_recent");
    expect(result.perItemBreakdown[0]!.estimateEur).toBe(0);
    expect(result.totalEstimateEur).toBe(0);
  });

  it("does NOT skip refresh items past the freshness threshold", async () => {
    const now = Date.now();
    const staleArticle = {
      frontmatterUpdatedAt: null,
      lastRefreshedAt: null,
      publishedAt: new Date(now - 90 * 86_400_000),
      updatedAt: new Date(now - 90 * 86_400_000),
    };
    const plannedItems: PlannedItem[] = [
      {
        id: "i1",
        itemType: "refresh",
        pipelineName: "article:refresh",
        predictedInput: {},
        refreshArticle: staleArticle,
      },
    ];
    const result = await estimateWeeklyPlanCost({
      plannedItems,
      weeklyBudgetEur: 100,
      projectId: NEVER_MATCHED_PROJECT_ID,
      resolvePipelineSteps: () => [step(0.4)],
    });
    expect(result.perItemBreakdown[0]!.source).toBe("pipeline_steps");
    expect(result.perItemBreakdown[0]!.estimateEur).toBeCloseTo(0.4, 6);
  });

  it("tier 2: historical avg wins when tier 1 returns 0 and DB has matching cost_logs", async () => {
    // Use a real project; create a parent + substep pipeline_run + cost_logs entries.
    const [project] = await db
      .insert(projects)
      .values({
        slug: `wb-test-${Date.now()}`,
        name: "weekly-budget-test",
        industry: "other",
        pipelineTemplate: "educational",
        marketingContextMd: "",
      })
      .returning();
    if (!project) throw new Error("project insert failed");

    try {
      const PIPELINE = "test:tier2-pipeline";
      // Insert 2 parent runs of the same pipeline name, each with one substep + cost_log.
      for (const cost of [0.12, 0.18]) {
        const [parent] = await db
          .insert(pipelineRuns)
          .values({
            projectId: project.id,
            pipelineName: PIPELINE,
            stepName: null,
            status: "completed",
            startedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
            completedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          })
          .returning();
        if (!parent) throw new Error("parent insert failed");
        const [substep] = await db
          .insert(pipelineRuns)
          .values({
            projectId: project.id,
            pipelineName: PIPELINE,
            stepName: "step-a",
            status: "completed",
            parentRunId: parent.id,
            startedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
            completedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          })
          .returning();
        if (!substep) throw new Error("substep insert failed");
        await db.insert(costLogs).values({
          projectId: project.id,
          service: "anthropic",
          operation: "test-tier2",
          costEur: String(cost),
          pipelineRunId: substep.id,
        });
      }

      const result = await estimateWeeklyPlanCost({
        plannedItems: [
          { id: "i1", itemType: "unmapped", pipelineName: PIPELINE, predictedInput: {} },
        ],
        weeklyBudgetEur: 100,
        projectId: project.id,
        // No resolvePipelineSteps → tier 1 skipped → tier 2 should fire.
      });

      expect(result.perItemBreakdown[0]!.source).toBe("historical_avg");
      // Average of 0.12 and 0.18 = 0.15
      expect(result.perItemBreakdown[0]!.estimateEur).toBeCloseTo(0.15, 6);
    } finally {
      // Cleanup — cost_logs cascade via project FK
      await db.delete(projects).where(eq(projects.id, project.id));
    }
  });
});
