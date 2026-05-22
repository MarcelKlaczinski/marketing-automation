// Spec 62.4 Step 8: assign each draft a slot_date within the target week.
//
// Heuristic placement:
//   - cluster items spread across the week (round-robin Mon..Sun)
//   - comparison → Wednesday
//   - ki_wissen  → Thursday (overflow to Friday)
//   - social_post → round-robin across all 7 days (up to ~3 per day)
//
// Spec 62.4-followup Issue 1 removed the sibling-locale second pass — the
// cluster:full-plan → article:blog → article:translation chain now produces
// DE+EN internally, so there is no second planned_item to schedule. Items
// that arrive here with `sourceKind = 'sibling_locale'` would only originate
// from legacy callers; they fall through the same primary placement path.

import { addDaysUtc, isoWeekStartDate } from "@marketing-auto/planner";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import type { PlanningItemDraft } from "../types.ts";

export const distributeSlotsInputSchema = z.object({
  projectId: z.string().uuid(),
  targetYear: z.number().int(),
  targetIsoWeek: z.number().int(),
});
type Input = z.infer<typeof distributeSlotsInputSchema>;

export const distributeSlotsOutputSchema = z.object({
  distributedItems: z.array(z.unknown()),
});
type Output = z.infer<typeof distributeSlotsOutputSchema>;

export class DistributeSlotDatesStep extends BaseStep<Input, Output> {
  readonly name = "distribute-slot-dates";
  readonly inputSchema = distributeSlotsInputSchema;
  readonly outputSchema = distributeSlotsOutputSchema;

  async execute(input: Input, ctx: StepContext): Promise<Output> {
    const floor =
      ctx.getStepOutput<{ floorItems: PlanningItemDraft[] }>("select-floor-items")?.floorItems ??
      [];
    const overage =
      ctx.getStepOutput<{ overageItems: PlanningItemDraft[] }>("select-overage-items")
        ?.overageItems ?? [];
    const social =
      ctx.getStepOutput<{ socialItems: PlanningItemDraft[] }>("select-social-post-items")
        ?.socialItems ?? [];

    const weekStart = isoWeekStartDate(input.targetYear, input.targetIsoWeek);

    // Round-robin counters keyed by content type.
    const counters: Record<string, number> = { cluster: 0, social_post: 0, ki_wissen: 0 };

    const placed: PlanningItemDraft[] = [];
    for (const item of [...floor, ...overage, ...social]) {
      const slotDate = item.slotDate ?? this.placePrimary(item.contentType, counters, weekStart);
      placed.push({ ...item, slotDate });
    }

    return { distributedItems: placed };
  }

  /**
   * Place one primary item using the per-content-type heuristic. Mutates
   * `counters` so subsequent calls produce the next slot.
   */
  private placePrimary(
    contentType: PlanningItemDraft["contentType"],
    counters: Record<string, number>,
    weekStart: Date,
  ): Date {
    switch (contentType) {
      case "cluster": {
        // Mon..Sun round-robin.
        const offset = (counters.cluster ?? 0) % 7;
        counters.cluster = (counters.cluster ?? 0) + 1;
        return addDaysUtc(weekStart, offset);
      }
      case "cluster_spoke": {
        // Spec 64.1: spokes are spread Mon..Sun with their own counter so
        // they don't pile onto the same days as new-cluster items. A typical
        // week has 1-2 cluster + 5-10 cluster_spokes, so a separate
        // round-robin keeps the calendar evenly populated.
        const offset = (counters.cluster_spoke ?? 0) % 7;
        counters.cluster_spoke = (counters.cluster_spoke ?? 0) + 1;
        return addDaysUtc(weekStart, offset);
      }
      case "comparison":
        // Single Wednesday slot per week (multiple comparisons stack on Wed).
        return addDaysUtc(weekStart, 2);
      case "ki_wissen": {
        // Alternate Thursday/Friday.
        const idx = counters.ki_wissen ?? 0;
        counters.ki_wissen = idx + 1;
        return addDaysUtc(weekStart, idx % 2 === 0 ? 3 : 4);
      }
      case "social_post": {
        // Spread across the full week.
        const idx = counters.social_post ?? 0;
        counters.social_post = idx + 1;
        return addDaysUtc(weekStart, idx % 7);
      }
    }
  }
}
