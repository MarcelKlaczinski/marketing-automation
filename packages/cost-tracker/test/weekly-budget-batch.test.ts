// Spec 62.5.1: batch-discount behaviour for `estimateWeeklyPlanCost`.
//
// Sync mode = unchanged tier-1 sum.
// Batch mode + llmBound=true = step contribution × BATCH_DISCOUNT_FACTOR (0.5).
// Batch mode + llmBound=false (mixed cost) = unchanged.
// Tier 2/3 (historical avg + defaults) are NOT discounted — they aggregate past runs.

import { describe, expect, it } from "bun:test";
import {
  BATCH_DISCOUNT_FACTOR,
  BUFFER_FACTOR,
  estimateWeeklyPlanCost,
  type EstimatorStep,
  type PlannedItem,
} from "../src/weekly-budget.ts";

const NEVER_MATCHED_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

const llmStep = (cost: number): EstimatorStep => ({
  estimatedCostEur: () => cost,
  llmBound: true,
});

const nonLlmStep = (cost: number): EstimatorStep => ({
  estimatedCostEur: () => cost,
  llmBound: false,
});

describe("estimateWeeklyPlanCost — batch discount (Spec 62.5.1)", () => {
  it("sync mode: no discount applied even when llmBound=true", async () => {
    const plannedItems: PlannedItem[] = [
      { id: "i1", itemType: "article", pipelineName: "p1", predictedInput: {} },
    ];
    const result = await estimateWeeklyPlanCost({
      plannedItems,
      weeklyBudgetEur: 100,
      projectId: NEVER_MATCHED_PROJECT_ID,
      resolvePipelineSteps: (name) =>
        name === "p1" ? [llmStep(0.2), llmStep(0.3)] : undefined,
      llmMode: "sync",
    });
    expect(result.totalEstimateEur).toBeCloseTo(0.5, 6);
    expect(result.perItemBreakdown[0]!.source).toBe("pipeline_steps");
  });

  it("batch mode: halves contribution of llmBound steps", async () => {
    const plannedItems: PlannedItem[] = [
      { id: "i1", itemType: "article", pipelineName: "p1", predictedInput: {} },
    ];
    const result = await estimateWeeklyPlanCost({
      plannedItems,
      weeklyBudgetEur: 100,
      projectId: NEVER_MATCHED_PROJECT_ID,
      resolvePipelineSteps: (name) =>
        name === "p1" ? [llmStep(0.2), llmStep(0.3)] : undefined,
      llmMode: "batch",
    });
    const expected = 0.5 * BATCH_DISCOUNT_FACTOR;
    expect(result.totalEstimateEur).toBeCloseTo(expected, 6);
    expect(result.perItemBreakdown[0]!.source).toBe("pipeline_steps");
    expect(result.bufferedEstimateEur).toBeCloseTo(expected * BUFFER_FACTOR, 6);
  });

  it("batch mode: mixed pipeline (llmBound + non-llmBound) gets partial discount", async () => {
    const plannedItems: PlannedItem[] = [
      { id: "i1", itemType: "article", pipelineName: "p1", predictedInput: {} },
    ];
    const result = await estimateWeeklyPlanCost({
      plannedItems,
      weeklyBudgetEur: 100,
      projectId: NEVER_MATCHED_PROJECT_ID,
      resolvePipelineSteps: (name) =>
        // 0.4 LLM-bound → 0.2 in batch mode; 0.1 non-LLM (e.g. SERP fetch) → 0.1
        name === "p1" ? [llmStep(0.4), nonLlmStep(0.1)] : undefined,
      llmMode: "batch",
    });
    const expected = 0.4 * BATCH_DISCOUNT_FACTOR + 0.1;
    expect(result.totalEstimateEur).toBeCloseTo(expected, 6);
  });

  it("batch mode: step without llmBound flag (undefined) is NOT discounted", async () => {
    // Backwards compat: an EstimatorStep without the flag means "not LLM-bound".
    const noFlagStep: EstimatorStep = { estimatedCostEur: () => 0.4 };
    const plannedItems: PlannedItem[] = [
      { id: "i1", itemType: "article", pipelineName: "p1", predictedInput: {} },
    ];
    const result = await estimateWeeklyPlanCost({
      plannedItems,
      weeklyBudgetEur: 100,
      projectId: NEVER_MATCHED_PROJECT_ID,
      resolvePipelineSteps: (name) => (name === "p1" ? [noFlagStep] : undefined),
      llmMode: "batch",
    });
    expect(result.totalEstimateEur).toBeCloseTo(0.4, 6);
  });

  it("llmMode omitted defaults to no discount (backwards compat)", async () => {
    const plannedItems: PlannedItem[] = [
      { id: "i1", itemType: "article", pipelineName: "p1", predictedInput: {} },
    ];
    const result = await estimateWeeklyPlanCost({
      plannedItems,
      weeklyBudgetEur: 100,
      projectId: NEVER_MATCHED_PROJECT_ID,
      resolvePipelineSteps: (name) => (name === "p1" ? [llmStep(0.5)] : undefined),
      // llmMode omitted
    });
    expect(result.totalEstimateEur).toBeCloseTo(0.5, 6);
  });

  it("batch mode does NOT discount tier-3 defaults", async () => {
    // No resolvePipelineSteps → tier 1 skipped; never-matched project → tier 2 empty.
    // Tier 3 returns DEFAULT_COST_BY_ITEM_TYPE.article = 0.3, unmodified by llmMode.
    const plannedItems: PlannedItem[] = [
      { id: "i1", itemType: "article", pipelineName: "unknown:pipeline", predictedInput: {} },
    ];
    const result = await estimateWeeklyPlanCost({
      plannedItems,
      weeklyBudgetEur: 100,
      projectId: NEVER_MATCHED_PROJECT_ID,
      llmMode: "batch",
    });
    expect(result.totalEstimateEur).toBeCloseTo(0.3, 6);
    expect(result.perItemBreakdown[0]!.source).toBe("default");
  });
});
