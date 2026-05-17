import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";

export interface DiscoveryCounts {
  trendsPending: number;
  gapsOpen: number;
  refreshCandidates: number;
}

export function useDiscoveryCounts() {
  const projectStore = useProjectStore();

  const { data } = useQuery({
    queryKey: computed(() => ["discovery-counts", projectStore.currentSlug]),
    queryFn: () =>
      apiGet<DiscoveryCounts>(
        `/projects/${projectStore.currentSlug}/discovery-counts`,
      ),
    refetchInterval: 60_000,
  });

  return {
    trendsPending: computed(() => data.value?.trendsPending ?? 0),
    gapsOpen: computed(() => data.value?.gapsOpen ?? 0),
    refreshCandidates: computed(() => data.value?.refreshCandidates ?? 0),
  };
}
