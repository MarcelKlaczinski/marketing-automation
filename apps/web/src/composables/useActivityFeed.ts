import { useQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import type { PipelineRunSummary } from "src/types/ui";

/**
 * Returns the list of active (running + queued) pipeline runs for the
 * current project. Uses TanStack Query with a 60 s backup poll interval;
 * SSE events from `usePipelineEvents` invalidate this cache in real-time.
 */
export function useActivityFeed() {
  const projectStore = useProjectStore();

  return useQuery({
    queryKey: ["pipeline-runs", "active", projectStore.currentSlug],
    queryFn: () =>
      apiGet<PipelineRunSummary[]>(
        `/projects/${projectStore.currentSlug}/pipeline-runs?status=active`,
      ),
    refetchInterval: 60_000,
    enabled: !!projectStore.currentSlug,
  });
}
