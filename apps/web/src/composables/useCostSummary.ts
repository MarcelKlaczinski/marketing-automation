import { type MaybeRef, unref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import type { CostSummary } from "src/types/ui";

/**
 * Fetches cost summary for the current project over the given time window.
 * Refetches every 60 s and also when `usePipelineEvents` invalidates
 * the "cost-summary" query key after a pipeline completes.
 *
 * Accepts a plain string or Ref<string> so Options API components can pass
 * a literal without needing to call ref() (which is Composition API).
 *
 * @param timeWindow - "today" | "week" | "month" or a Ref to one of those
 */
export function useCostSummary(timeWindow: MaybeRef<"today" | "week" | "month">) {
  const projectStore = useProjectStore();

  return useQuery({
    queryKey: ["cost-summary", projectStore.currentSlug, timeWindow],
    queryFn: () =>
      apiGet<CostSummary>(
        `/projects/${projectStore.currentSlug}/cost-summary?window=${unref(timeWindow)}`,
      ),
    refetchInterval: 60_000,
    enabled: !!projectStore.currentSlug,
  });
}
