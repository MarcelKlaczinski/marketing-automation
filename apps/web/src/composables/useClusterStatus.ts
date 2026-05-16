import { type MaybeRef, unref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import type { ClusterCardData } from "src/types/ui";

/**
 * Polls the generation status of a single cluster.
 * Uses a 30 s refetch interval; SSE `cluster.status.changed` events
 * from `usePipelineEvents` invalidate the same cache key in real-time.
 *
 * Accepts a plain string or Ref<string> so Options API components can pass
 * a value without needing to call ref() (which is Composition API).
 *
 * @param clusterId - cluster UUID or a Ref to one
 */
export function useClusterStatus(clusterId: MaybeRef<string>) {
  const projectStore = useProjectStore();

  return useQuery({
    queryKey: ["cluster-generation-status", clusterId],
    queryFn: () =>
      apiGet<ClusterCardData>(
        `/projects/${projectStore.currentSlug}/clusters/${unref(clusterId)}/generation-status`,
      ),
    enabled: !!unref(clusterId),
    refetchInterval: 30_000,
  });
}
