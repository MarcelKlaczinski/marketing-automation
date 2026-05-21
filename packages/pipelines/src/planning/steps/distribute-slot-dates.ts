// Spec 62.4 Step 8: assign each draft a slot_date within the target week.
//
// Heuristic placement:
//   - cluster items spread across the week (round-robin Mon..Sun)
//   - comparison → Wednesday
//   - ki_wissen  → Thursday (overflow to Friday)
//   - social_post → round-robin across all 7 days (up to ~3 per day)
//   - siblings → parent.slotDate + 1 day, clamped to the same week (overflow
//     to Saturday/Sunday). Sundays for siblings are allowed; the spec rejected
//     pushing into next week to keep one plan = one week.

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
    const siblings =
      ctx.getStepOutput<{ siblingItems: PlanningItemDraft[] }>("apply-sibling-locale")
        ?.siblingItems ?? [];

    const weekStart = isoWeekStartDate(input.targetYear, input.targetIsoWeek);

    // Round-robin counters keyed by content type.
    const counters: Record<string, number> = { cluster: 0, social_post: 0, ki_wissen: 0 };

    // First pass: place all non-sibling items.
    const placed: PlanningItemDraft[] = [];
    for (const item of [...floor, ...overage]) {
      const slotDate = this.placePrimary(item.contentType, counters, weekStart);
      placed.push({ ...item, slotDate });
    }

    // Second pass: siblings inherit parent.slotDate + 1 day, clamped to Sun.
    const byDraftId = new Map(placed.map((it) => [it.draftId, it]));
    const siblingsPlaced: PlanningItemDraft[] = siblings.map((sib) => {
      const parent = sib.parentDraftId ? byDraftId.get(sib.parentDraftId) : undefined;
      const baseDate = parent?.slotDate ?? weekStart;
      const ideal = addDaysUtc(baseDate, 1);
      // Clamp to the target week (Mon..Sun = 7 days). Spec 62.4 §4.2.7 chose
      // to push into Sun rather than overflow into the next week.
      const sunday = addDaysUtc(weekStart, 6);
      const slotDate = ideal.getTime() > sunday.getTime() ? sunday : ideal;
      return { ...sib, slotDate };
    });

    return { distributedItems: [...placed, ...siblingsPlaced] };
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
