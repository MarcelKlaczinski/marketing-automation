// Spec 62.4 §6.1: BudgetGateStep — hard-stop on budget overrun.

import { describe, expect, it } from "bun:test";
import type { WeeklyBudgetEstimate } from "@marketing-auto/cost-tracker";
import type { ProjectPlannerConfig } from "@marketing-auto/db";
import {
  BudgetExceededError,
  BudgetGateStep,
  type PlanningItemDraft,
} from "../../src/planning/index.ts";
import { makeMockCtx } from "../fixtures/mock-ctx.ts";

const projectId = "00000000-0000-0000-0000-0000000000ae";

function config(overrides: Partial<ProjectPlannerConfig> = {}): ProjectPlannerConfig {
  return {
    projectId,
    weeklyBudgetEur: "50.00",
    perTypeMaxEur: null,
    topNSignalsAllowedOverage: 3,
    maxOveragePerSignal: 1,
    signalMaxAgeHours: 24,
    excludedPipelines: [],
    // Spec 62.7 added these as NOT NULL with defaults — fixture must include them
    // since the inferred type widened to require them.
    cronEnabled: false,
    cronDayOfWeek: 0,
    cronHourUtc: 18,
    // Spec 63.3b: second cron — same NOT-NULL-with-defaults requirement.
    comparisonCronEnabled: false,
    comparisonCronDayOfWeek: 0,
    comparisonCronHourUtc: 6,
    // Spec 63.4: third cron (trends_synthesizer). dayOfWeek nullable → daily cadence.
    trendSynthCronEnabled: false,
    trendSynthCronDayOfWeek: null,
    trendSynthCronHourUtc: 1,
    // Spec 63.5: numeric(4,3) on the DB side → string at the Drizzle boundary.
    diversityThreshold: "0.5",
    diversityMalusWeight: "0.5",
    // Spec 64.14: per-project signal-source override; null = use defaults.
    signalSourceContentTypeMap: null,
    // Spec 64.19 / Phase D: per-project trend-score weights; null = use defaults.
    trendScoreWeights: null,
    // Spec 64.21: per-project star-trend config; null = use defaults.
    starTrendConfig: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function estimateWithinBudget(): WeeklyBudgetEstimate {
  return {
    totalEstimateEur: 10,
    bufferedEstimateEur: 11.5,
    perItemBreakdown: [],
    budgetEur: 50,
    withinBudget: true,
    overrunEur: null,
  };
}

function estimateOverBudget(): WeeklyBudgetEstimate {
  return {
    totalEstimateEur: 100,
    bufferedEstimateEur: 115,
    perItemBreakdown: [],
    budgetEur: 50,
    withinBudget: false,
    overrunEur: 65,
  };
}

describe("BudgetGateStep", () => {
  const step = new BudgetGateStep();

  it("passes when withinBudget=true", async () => {
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { config: config() } as never;
        if (name === "estimate-cost")
          return { costEstimate: estimateWithinBudget(), itemsWithCost: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    expect(out.perTypeWarnings).toEqual([]);
  });

  it("throws BudgetExceededError when withinBudget=false", async () => {
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals") return { config: config() } as never;
        if (name === "estimate-cost")
          return { costEstimate: estimateOverBudget(), itemsWithCost: [] } as never;
        return undefined;
      },
    });
    await expect(step.execute({ projectId }, ctx)).rejects.toThrow(BudgetExceededError);
  });

  it("emits soft per-type warnings without failing", async () => {
    const items: PlanningItemDraft[] = [
      {
        draftId: "x",
        contentType: "cluster",
        pipelineName: "cluster:full-plan",
        sourceKind: "floor",
        sourceBriefId: null,
        sourceSignalId: null,
        parentDraftId: null,
        locale: null,
        pipelineInput: {},
        slotDate: new Date(),
        selectionScore: null,
        selectionReason: "x",
        estimatedCostEur: 10,
      },
    ];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "validate-goals")
          return { config: config({ perTypeMaxEur: { cluster: 5 } }) } as never;
        if (name === "estimate-cost")
          return { costEstimate: estimateWithinBudget(), itemsWithCost: items } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    expect(out.perTypeWarnings).toHaveLength(1);
    expect(out.perTypeWarnings[0]).toEqual({
      contentType: "cluster",
      spendEur: 10,
      maxEur: 5,
    });
  });
});
