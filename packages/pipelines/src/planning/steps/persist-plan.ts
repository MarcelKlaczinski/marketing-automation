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
    const socialShortfall = ctx.getStepOutput<{ shortfall: number }>(
      "select-social-post-items",
    )?.shortfall;
    const perTypeWarnings = ctx.getStepOutput<{
      perTypeWarnings: Array<{ contentType: string; spendEur: number; maxEur: number }>;
    }>("budget-gate")?.perTypeWarnings;

    if (!estimate || !snapshot) {
      throw new Error("persist-plan: prior step output missing");
    }

    const weekStart = isoWeekStartDate(input.targetYear, input.targetIsoWeek);
    const weekEnd = isoWeekEndDate(input.targetYear, input.targetIsoWeek);

    // Merge social_post shortfall into the shortfall map so the generation
    // notes surface it under social_post (Spec 62.4-followup Issue 2).
    const allShortfalls: Record<string, number> = { ...(floorShortfalls ?? {}) };
    if (socialShortfall && socialShortfall > 0) {
      allShortfalls.social_post = (allShortfalls.social_post ?? 0) + socialShortfall;
    }

    const generationNotes = buildGenerationNotes({
      itemCount: items.length,
      bufferedEstimateEur: estimate.bufferedEstimateEur,
      shortfalls: allShortfalls,
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
      // Spec 62.6: on debug-mode resume the upstream step output came through
      // JSONB on pipeline_runs.suspensionCheckpoint — Date is now an ISO string.
      // Drizzle's date({mode:"date"}) column calls value.toISOString() on insert
      // and crashes when it sees a string. Normalize back to Date.
      const itemSlotDate = toDate(it.slotDate) ?? weekStart;
      const row: Omit<NewPlannedItem, "weeklyPlanId"> = {
        id: it.draftId,
        projectId: input.projectId,
        contentType: it.contentType,
        pipelineName: it.pipelineName,
        slotDate: itemSlotDate,
        // Spec 62.4-followup Issue 1: locale persisted (nullable). null means
        // the pipeline produces both locales internally; 'de'/'en' marks an
        // explicit single-locale planned_item (e.g. comparison, ki_wissen).
        locale: it.locale,
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

/**
 * Normalize a Date OR an ISO-string into a Date. On debug-mode resume the
 * upstream step output arrives via JSONB so every Date is now a string;
 * in a production end-to-end run it stays a real Date in memory. Returns
 * null when the input is null/undefined (caller decides the fallback).
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  return new Date(value);
}
