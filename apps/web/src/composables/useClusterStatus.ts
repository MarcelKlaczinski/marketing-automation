import { type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import type { ClusterCardData } from "src/types/ui";

/**
 * Polls the generation status of a single cluster.
 * Uses a 30 s refetch interval; SSE `cluster.status.changed` events
 * from `usePipelineEvents` invalidate the same cache key in real-time.
 *
 * @param clusterId - reactive ref to the cluster UUID
 */
export function useClusterStatus(clusterId: Ref<string>) {
  const projectStore = useProjectStore();

  return useQuery({
    queryKey: ["cluster-generation-status", clusterId],
    queryFn: () =>
      apiGet<ClusterCardData>(
        `/projects/${projectStore.currentSlug}/clusters/${clusterId.value}/generation-status`,
      ),
    enabled: !!clusterId.value,
    refetchInterval: 30_000,
  });
}
