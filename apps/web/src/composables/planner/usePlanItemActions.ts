import { useQueryClient } from "@tanstack/vue-query";
import { apiPatch, apiPost } from "src/lib/api";
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
  // Spec 62.8
  retryItem: (planId: string, itemId: string) => Promise<PlannedItem>;
  cancelPendingItems: (planId: string) => Promise<{ cancelled: number; generatingUntouched: number }>;
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

  // Spec 62.8: manual retry of a single failed item. The backend resets the
  // row to 'pending' and re-enqueues the plan-execution worker (deterministic
  // jobId dedups when a dispatch is already in flight).
  async function retryItem(planId: string, itemId: string): Promise<PlannedItem> {
    try {
      const res = await apiPost<{ item?: PlannedItem } | PlannedItem>(
        `/projects/${projectStore.currentSlug}/planned-items/${itemId}/retry`,
      );
      // apiPost unwraps `{ ok, data }` to the inner payload. The route returns
      // `{ ok: true, data: <PlannedItem>, executionEnqueued: boolean }` so the
      // inner is the PlannedItem itself.
      const updated = (res as PlannedItem) ?? null;
      if (updated) {
        patchItemInCache(queryClient, projectStore.currentSlug, planId, itemId, () => updated);
      } else {
        await queryClient.invalidateQueries({ queryKey: ["planner"] });
      }
      return updated as PlannedItem;
    } catch (err) {
      await queryClient.invalidateQueries({ queryKey: ["planner"] });
      throw err;
    }
  }

  // Spec 62.8 §5.5: bulk-cancel all pending + enqueued items.
  async function cancelPendingItems(
    planId: string,
  ): Promise<{ cancelled: number; generatingUntouched: number }> {
    try {
      const result = await apiPost<{ cancelled: number; generatingUntouched: number }>(
        `/projects/${projectStore.currentSlug}/plans/${planId}/cancel-pending`,
        {},
      );
      // Reset every cached pending/enqueued item to 'cancelled'. The server
      // already committed — patching the cache keeps the UI snappy.
      qcSetCancelledForPending(queryClient, projectStore.currentSlug, planId);
      return result;
    } catch (err) {
      await queryClient.invalidateQueries({ queryKey: ["planner"] });
      throw err;
    }
  }

  return {
    cancelItem,
    rescheduleItem,
    approvePlan,
    cancelPlan,
    approveSelected,
    retryItem,
    cancelPendingItems,
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

/**
 * Spec 62.8: flip every cached item that is currently pending or enqueued to
 * 'cancelled'. Mirrors the server-side `cancelPendingItemsForPlan` WHERE
 * clause so the optimistic update stays consistent.
 */
function qcSetCancelledForPending(
  qc: ReturnType<typeof useQueryClient>,
  slug: string,
  planId: string,
): void {
  qc.setQueryData<{ plan: WeeklyPlan; items: PlannedItem[] } | undefined>(
    ["planner", "plan-detail", slug, planId],
    (prev) => {
      if (!prev) return prev;
      const items = prev.items.map((it) =>
        it.status === "pending" || it.status === "enqueued"
          ? { ...it, status: "cancelled" as const }
          : it,
      );
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
