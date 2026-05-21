import { ref, watch, type Ref } from "vue";
import { useWeeklyPlan } from "./useWeeklyPlan";
import { getIsoWeek, shiftIsoWeek } from "src/lib/iso-week";
import type { PlannedItem, WeeklyPlan } from "src/types/ui";

/**
 * Owns the (year, isoWeek) ref pair + plan query for the item-detail page.
 *
 * We don't have a dedicated GET /planned-items/:id endpoint — the detail page
 * has to discover which plan owns the item by querying weekly plans. The
 * strategy: start at the current ISO week, then search a small ±N window if
 * the item isn't found. The window is bounded so a stale URL doesn't trigger
 * runaway requests.
 *
 * Extracted into a composable to keep the page's `setup()` free of
 * Composition-API primitives (apps/web/CLAUDE.md convention).
 */
export function usePlanItemContext(itemId: string, searchWindowWeeks = 4): {
  year: Ref<number>;
  isoWeek: Ref<number>;
  plan: Ref<WeeklyPlan | null>;
  items: Ref<PlannedItem[]>;
  isPending: Ref<boolean>;
  /** True once the item has been located inside the current `items` page. */
  resolved: Ref<boolean>;
} {
  const now = getIsoWeek(new Date());
  const year = ref<number>(now.year);
  const isoWeek = ref<number>(now.isoWeek);
  const resolved = ref<boolean>(false);

  const { plan, items, isPending } = useWeeklyPlan({ year, isoWeek });

  // Search-window state.
  let nextStep = 1;
  let direction: 1 | -1 = 1;
  let exhausted = false;

  watch(
    items,
    (current) => {
      if (resolved.value || current.length === 0 || exhausted) return;
      if (current.some((i) => i.id === itemId)) {
        resolved.value = true;
        return;
      }
      // Not in this week — try next step in the ±searchWindowWeeks rotation.
      if (nextStep > searchWindowWeeks) {
        exhausted = true;
        return;
      }
      const shifted = shiftIsoWeek(year.value, isoWeek.value, direction);
      year.value = shifted.year;
      isoWeek.value = shifted.isoWeek;
      if (direction === 1) {
        direction = -1;
      } else {
        direction = 1;
        nextStep += 1;
      }
    },
    { immediate: false },
  );

  return { year, isoWeek, plan, items, isPending, resolved };
}
