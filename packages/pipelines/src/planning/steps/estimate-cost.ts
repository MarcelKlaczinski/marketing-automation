// Spec 62.4 Step 9: per-item cost estimation via the cost-tracker's
// estimateWeeklyPlanCost (62.0a §5).
//
// `resolvePipelineSteps` is injected by the route handler (mirrors the
// validate-goals wiring). Each draft is converted to the `PlannedItem` shape
// `estimateWeeklyPlanCost` expects, the function runs the 3-tier estimate,
// then we copy `estimateEur` back onto the draft for downstream visibility.

import {
  estimateWeeklyPlanCost,
  type PipelineStepResolver,
  type WeeklyBudgetEstimate,
} from "@marketing-auto/cost-tracker";
import type { ProjectPlannerConfig } from "@marketing-auto/db";
import type { WeeklyPlanInputSnapshot } from "@marketing-auto/shared";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import type { PlanningItemDraft } from "../types.ts";

export const estimateCostInputSchema = z.object({
  projectId: z.string().uuid(),
});
type Input = z.infer<typeof estimateCostInputSchema>;

export const estimateCostOutputSchema = z.object({
  costEstimate: z.unknown(),
  itemsWithCost: z.array(z.unknown()),
});
type Output = z.infer<typeof estimateCostOutputSchema>;

export class EstimateCostStep extends BaseStep<Input, Output> {
  readonly name = "estimate-cost";
  readonly inputSchema = estimateCostInputSchema;
  readonly outputSchema = estimateCostOutputSchema;
  readonly resolvePipelineSteps?: PipelineStepResolver;

  constructor(resolvePipelineSteps?: PipelineStepResolver) {
    super();
    if (resolvePipelineSteps !== undefined) {
      this.resolvePipelineSteps = resolvePipelineSteps;
    }
  }

  async execute(input: Input, ctx: StepContext): Promise<Output> {
    const distributedItems =
      ctx.getStepOutput<{ distributedItems: PlanningItemDraft[] }>("distribute-slot-dates")
        ?.distributedItems ?? [];
    const config = ctx.getStepOutput<{ config: ProjectPlannerConfig }>("validate-goals")?.config;
    if (!config) {
      throw new Error("estimate-cost: validate-goals.config missing");
    }

    // Spec 62.5.1: read llmMode from the snapshot so the estimator can apply
    // the Batch API discount (~50%) to llmBound steps when batch mode is on.
    // SnapshotInputsStep loaded it once from projects.llmMode and persisted it
    // into inputSnapshot.config.llmMode for reproducibility.
    const snapshot = ctx.getStepOutput<{ snapshot: WeeklyPlanInputSnapshot }>(
      "snapshot-inputs",
    )?.snapshot;
    const llmMode: "sync" | "batch" = snapshot?.config.llmMode ?? "sync";

    const opts: Parameters<typeof estimateWeeklyPlanCost>[0] = {
      plannedItems: distributedItems.map((it) => ({
        id: it.draftId,
        itemType: it.contentType,
        pipelineName: it.pipelineName,
        predictedInput: it.pipelineInput,
      })),
      weeklyBudgetEur: Number(config.weeklyBudgetEur),
      projectId: input.projectId,
      llmMode,
    };
    if (this.resolvePipelineSteps !== undefined) {
      opts.resolvePipelineSteps = this.resolvePipelineSteps;
    }

    const estimate: WeeklyBudgetEstimate = await estimateWeeklyPlanCost(opts);

    const byDraftId = new Map(estimate.perItemBreakdown.map((r) => [r.itemId, r.estimateEur]));
    const itemsWithCost: PlanningItemDraft[] = distributedItems.map((it) => ({
      ...it,
      estimatedCostEur: byDraftId.get(it.draftId) ?? 0,
    }));

    return { costEstimate: estimate, itemsWithCost };
  }
}
