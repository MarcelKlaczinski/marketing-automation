// Spec 62.4 Step 10: hard-stop on weekly budget overrun.
//
// `estimateWeeklyPlanCost` already applies a 15% buffer; we compare
// `bufferedEstimateEur` against `config.weeklyBudgetEur` and throw
// BudgetExceededError if exceeded. Per-type budgets (`perTypeMaxEur`) are
// soft — when exceeded we log a warning but don't trim (62.4 keeps the
// item set the user can see in the draft plan; if Marcel wants to cut
// items he does so via the calendar UI in 62.5).

import type { WeeklyBudgetEstimate } from "@marketing-auto/cost-tracker";
import type { ProjectPlannerConfig } from "@marketing-auto/db";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { BudgetExceededError } from "../errors.ts";
import type { PlanningItemDraft } from "../types.ts";

export const budgetGateInputSchema = z.object({
  projectId: z.string().uuid(),
});
type Input = z.infer<typeof budgetGateInputSchema>;

export const budgetGateOutputSchema = z.object({
  finalEstimate: z.unknown(),
  perTypeWarnings: z.array(
    z.object({ contentType: z.string(), spendEur: z.number(), maxEur: z.number() }),
  ),
});
type Output = z.infer<typeof budgetGateOutputSchema>;

export class BudgetGateStep extends BaseStep<Input, Output> {
  readonly name = "budget-gate";
  readonly inputSchema = budgetGateInputSchema;
  readonly outputSchema = budgetGateOutputSchema;

  async execute(_input: Input, ctx: StepContext): Promise<Output> {
    const estimate = ctx.getStepOutput<{ costEstimate: WeeklyBudgetEstimate }>("estimate-cost")
      ?.costEstimate;
    const itemsWithCost =
      ctx.getStepOutput<{ itemsWithCost: PlanningItemDraft[] }>("estimate-cost")?.itemsWithCost ??
      [];
    const config = ctx.getStepOutput<{ config: ProjectPlannerConfig }>("validate-goals")?.config;
    if (!estimate || !config) {
      throw new Error("budget-gate: prior step output missing");
    }

    if (!estimate.withinBudget) {
      throw new BudgetExceededError({
        bufferedEstimateEur: estimate.bufferedEstimateEur,
        budgetEur: estimate.budgetEur,
        overrunEur: estimate.overrunEur ?? 0,
      });
    }

    // Soft per-type budget check.
    const perTypeWarnings: Output["perTypeWarnings"] = [];
    if (config.perTypeMaxEur) {
      const spendByType = new Map<string, number>();
      for (const it of itemsWithCost) {
        spendByType.set(
          it.contentType,
          (spendByType.get(it.contentType) ?? 0) + (it.estimatedCostEur ?? 0),
        );
      }
      for (const [contentType, maxEur] of Object.entries(config.perTypeMaxEur)) {
        const spend = spendByType.get(contentType) ?? 0;
        if (spend > maxEur) {
          perTypeWarnings.push({ contentType, spendEur: spend, maxEur });
          ctx.log.warn(
            { contentType, spend, maxEur },
            "budget-gate: per-type spend exceeds cap (soft warning)",
          );
        }
      }
    }

    return { finalEstimate: estimate, perTypeWarnings };
  }
}
