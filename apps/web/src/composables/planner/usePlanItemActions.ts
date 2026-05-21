import { useQueryClient } from "@tanstack/vue-query";
import { apiPatch } from "src/lib/api";
import { useProjectStore } from "src/stores/project";
import type { PlannedItem, WeeklyPlan } from "src/types/ui";

/**
 * Approve/Cancel/Reschedule helpers with optimistic updates against the
 * `["planner", "plan-detail", slug, planId]` query cache. On error, the cache
 * is invalidated so the next refetch resyncs from the server.
 *
 * Approve-Selected (Option A) cancels the unselected items first, then flips
 * the plan to `approved`. The cancel calls are sequential — partial failures
 * leave previously-cancelled items cancelled and abort the approve step.
 */
export function usePlanItemActions(): {
  cancelItem: (planId: string, itemId: string) => Promise<PlannedItem>;
  rescheduleItem: (planId: string, itemId: string, newSlotDate: string) => Promise<PlannedItem>;
  approvePlan: (planId: string) => Promise<WeeklyPlan>;
  cancelPlan: (planId: string) => Promise<WeeklyPlan>;
  approveSelected: (
    planId: string,
    keepIds: ReadonlySet<string>,
    allPendingIds: readonly string[],
  ) => Promise<{ cancelledCount: number; approved: WeeklyPlan }>;
} {
  const projectStore = useProjectStore();
  const queryClient = useQueryClient();

  async function cancelItem(planId: string, itemId: string): Promise<PlannedItem> {
    try {
      const updated = await apiPatch<PlannedItem>(
        `/projects/${projectStore.currentSlug}/plans/${planId}/items/${itemId}`,
        { status: "cancelled" },
      );
      // Optimistic: patch the item inside the cached detail payload so the
      // calendar refresh is instant. A full invalidate would briefly show a
      // loading state — patching keeps the UI snappy.
      patchItemInCache(queryClient, projectStore.currentSlug, planId, itemId, () => updated);
      return updated;
    } catch (err) {
      await queryClient.invalidateQueries({ queryKey: ["planner"] });
      throw err;
    }
  }

  async function rescheduleItem(
    planId: string,
    itemId: string,
    newSlotDate: string,
  ): Promise<PlannedItem> {
    try {
      const updated = await apiPatch<PlannedItem>(
        `/projects/${projectStore.currentSlug}/plans/${planId}/items/${itemId}`,
        { slotDate: newSlotDate },
      );
      patchItemInCache(queryClient, projectStore.currentSlug, planId, itemId, () => updated);
      return updated;
    } catch (err) {
      await queryClient.invalidateQueries({ queryKey: ["planner"] });
      throw err;
    }
  }

  async function approvePlan(planId: string): Promise<WeeklyPlan> {
    try {
      const updated = await apiPatch<WeeklyPlan>(
        `/projects/${projectStore.currentSlug}/plans/${planId}`,
        { status: "approved" },
      );
      patchPlanInCache(queryClient, projectStore.currentSlug, planId, () => updated);
      return updated;
    } catch (err) {
      await queryClient.invalidateQueries({ queryKey: ["planner"] });
      throw err;
    }
  }

  async function cancelPlan(planId: string): Promise<WeeklyPlan> {
    try {
      const updated = await apiPatch<WeeklyPlan>(
        `/projects/${projectStore.currentSlug}/plans/${planId}`,
        { status: "cancelled" },
      );
      patchPlanInCache(queryClient, projectStore.currentSlug, planId, () => updated);
      return updated;
    } catch (err) {
      await queryClient.invalidateQueries({ queryKey: ["planner"] });
      throw err;
    }
  }

  /**
   * Cancel-Unselected + Approve. `keepIds` are the items the user wants to
   * keep approved; the others (still in `pending`) are cancelled first.
   *
   * Strategy: sequential cancel (so one failure doesn't half-cancel a batch
   * in parallel). If any cancel fails, abort and throw — already-cancelled
   * items stay cancelled (acceptable per Punkt 1 of the user instructions).
   */
  async function approveSelected(
    planId: string,
    keepIds: ReadonlySet<string>,
    allPendingIds: readonly string[],
  ): Promise<{ cancelledCount: number; approved: WeeklyPlan }> {
    const toCancel = allPendingIds.filter((id) => !keepIds.has(id));
    let cancelledCount = 0;
    for (const id of toCancel) {
      await cancelItem(planId, id);
      cancelledCount += 1;
    }
    const approved = await approvePlan(planId);
    return { cancelledCount, approved };
  }

  return {
    cancelItem,
    rescheduleItem,
    approvePlan,
    cancelPlan,
    approveSelected,
  };
}

// ─── cache helpers ────────────────────────────────────────────────────────────

function patchItemInCache(
  qc: ReturnType<typeof useQueryClient>,
  slug: string,
  planId: string,
  itemId: string,
  patch: (prev: PlannedItem) => PlannedItem,
): void {
  qc.setQueryData<{ plan: WeeklyPlan; items: PlannedItem[] } | undefined>(
    ["planner", "plan-detail", slug, planId],
    (prev) => {
      if (!prev) return prev;
      const items = prev.items.map((it) => (it.id === itemId ? patch(it) : it));
      return { ...prev, items };
    },
  );
}

function patchPlanInCache(
  qc: ReturnType<typeof useQueryClient>,
  slug: string,
  planId: string,
  patch: (prev: WeeklyPlan) => WeeklyPlan,
): void {
  qc.setQueryData<{ plan: WeeklyPlan; items: PlannedItem[] } | undefined>(
    ["planner", "plan-detail", slug, planId],
    (prev) => {
      if (!prev) return prev;
      return { ...prev, plan: patch(prev.plan) };
    },
  );
  // The plan-list cache also holds the plan row — invalidate so list refetches.
  void qc.invalidateQueries({ queryKey: ["planner", "plans-list"] });
}
