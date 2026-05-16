import { type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import type { CostSummary } from "src/types/ui";

/**
 * Fetches cost summary for the current project over the given time window.
 * Refetches every 60 s and also when `usePipelineEvents` invalidates
 * the "cost-summary" query key after a pipeline completes.
 *
 * @param timeWindow - reactive ref: "today" | "week" | "month"
 */
export function useCostSummary(timeWindow: Ref<"today" | "week" | "month">) {
  const projectStore = useProjectStore();

  return useQuery({
    queryKey: ["cost-summary", projectStore.currentSlug, timeWindow],
    queryFn: () =>
      apiGet<CostSummary>(
        `/projects/${projectStore.currentSlug}/cost-summary?window=${timeWindow.value}`,
      ),
    refetchInterval: 60_000,
    enabled: !!projectStore.currentSlug,
  });
}
