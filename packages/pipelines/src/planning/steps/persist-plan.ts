// Spec 62.4 Step 11: durably persist the plan and its items.
//
// Wraps `persistWeeklyPlan` from packages/db/helpers/weekly-plan-write.ts.
// PlanAlreadyExistsError is allowed to bubble — the route handler translates
// it to HTTP 409.

import type { WeeklyBudgetEstimate } from "@marketing-auto/cost-tracker";
import {
  isoWeekEndDate,
  isoWeekStartDate,
} from "@marketing-auto/planner";
import {
  persistWeeklyPlan,
  type NewPlannedItem,
  type NewWeeklyPlan,
} from "@marketing-auto/db";
import type { WeeklyPlanInputSnapshot } from "@marketing-auto/shared";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import type { PlanningItemDraft } from "../types.ts";

export const persistPlanInputSchema = z.object({
  projectId: z.string().uuid(),
  targetYear: z.number().int(),
  targetIsoWeek: z.number().int(),
  triggeredBy: z.string(),
  force: z.boolean(),
});
type Input = z.infer<typeof persistPlanInputSchema>;

export const persistPlanOutputSchema = z.object({
  weeklyPlanId: z.string().uuid(),
  itemCount: z.number().int().min(0),
  estimatedCostEur: z.number().min(0),
  status: z.literal("draft"),
  supersededPlanId: z.string().uuid().nullable(),
});
type Output = z.infer<typeof persistPlanOutputSchema>;

export class PersistPlanStep extends BaseStep<Input, Output> {
  readonly name = "persist-plan";
  readonly inputSchema = persistPlanInputSchema;
  readonly outputSchema = persistPlanOutputSchema;

  // Trivial DB persist — not interesting to pause on (Spec 62.0a convention).
  override pausableInDebug(): boolean {
    return false;
  }

  async execute(input: Input, ctx: StepContext): Promise<Output> {
    const items =
      ctx.getStepOutput<{ itemsWithCost: PlanningItemDraft[] }>("estimate-cost")?.itemsWithCost ??
      [];
    const estimate = ctx.getStepOutput<{ finalEstimate: WeeklyBudgetEstimate }>(
      "budget-gate",
    )?.finalEstimate;
    const snapshot = ctx.getStepOutput<{ snapshot: WeeklyPlanInputSnapshot }>(
      "snapshot-inputs",
    )?.snapshot;

    const floorShortfalls = ctx.getStepOutput<{
      shortfallsByContentType: Record<string, number>;
    }>("select-floor-items")?.shortfallsByContentType;
    const perTypeWarnings = ctx.getStepOutput<{
      perTypeWarnings: Array<{ contentType: string; spendEur: number; maxEur: number }>;
    }>("budget-gate")?.perTypeWarnings;

    if (!estimate || !snapshot) {
      throw new Error("persist-plan: prior step output missing");
    }

    const weekStart = isoWeekStartDate(input.targetYear, input.targetIsoWeek);
    const weekEnd = isoWeekEndDate(input.targetYear, input.targetIsoWeek);

    const generationNotes = buildGenerationNotes({
      itemCount: items.length,
      bufferedEstimateEur: estimate.bufferedEstimateEur,
      shortfalls: floorShortfalls ?? {},
      perTypeWarnings: perTypeWarnings ?? [],
      triggeredBy: input.triggeredBy,
    });

    const plan: NewWeeklyPlan = {
      projectId: input.projectId,
      year: input.targetYear,
      isoWeek: input.targetIsoWeek,
      weekStartDate: weekStart,
      weekEndDate: weekEnd,
      status: "draft",
      estimatedCostEur: estimate.bufferedEstimateEur.toFixed(2),
      inputSnapshot: snapshot,
      generationNotes,
    };

    // Use the draftId AS the row id so sibling parent links can be set
    // directly at INSERT time. This avoids a post-INSERT UPDATE pass (which
    // would run outside the helper's transaction and could leave items with
    // null parent_item_id on partial failure). Drizzle allows overriding the
    // column's `defaultRandom()` by passing `id` explicitly.
    const itemRows: Array<Omit<NewPlannedItem, "weeklyPlanId">> = items.map((it) => {
      const row: Omit<NewPlannedItem, "weeklyPlanId"> = {
        id: it.draftId,
        projectId: input.projectId,
        contentType: it.contentType,
        pipelineName: it.pipelineName,
        slotDate: it.slotDate ?? weekStart,
        sourceKind: it.sourceKind,
        sourceBriefId: it.sourceBriefId,
        sourceSignalId: it.sourceSignalId,
        parentItemId: it.parentDraftId,
        pipelineInput: it.pipelineInput,
        estimatedCostEur: (it.estimatedCostEur ?? 0).toFixed(6),
        status: "pending",
        selectionReason: it.selectionReason,
      };
      if (it.selectionScore !== null) {
        row.selectionScore = it.selectionScore.toFixed(4);
      }
      return row;
    });

    const result = await persistWeeklyPlan({
      plan,
      items: itemRows,
      supersedeExisting: input.force,
    });

    return {
      weeklyPlanId: result.plan.id,
      itemCount: result.items.length,
      estimatedCostEur: Number(result.plan.estimatedCostEur),
      status: "draft",
      supersededPlanId: result.supersededId,
    };
  }
}

function buildGenerationNotes(input: {
  itemCount: number;
  bufferedEstimateEur: number;
  shortfalls: Record<string, number>;
  perTypeWarnings: Array<{ contentType: string; spendEur: number; maxEur: number }>;
  triggeredBy: string;
}): string {
  const lines: string[] = [
    `Generated ${input.itemCount} items.`,
    `Estimated cost (with 15% buffer): €${input.bufferedEstimateEur.toFixed(2)}.`,
    `Triggered by: ${input.triggeredBy}.`,
  ];
  for (const [type, missing] of Object.entries(input.shortfalls)) {
    lines.push(`Shortfall on ${type}: ${missing} fewer items than target (queue empty).`);
  }
  for (const w of input.perTypeWarnings) {
    lines.push(
      `Per-type cap exceeded: ${w.contentType} spends €${w.spendEur.toFixed(2)} (cap €${w.maxEur.toFixed(2)}).`,
    );
  }
  return lines.join("\n");
}
