<template>
  <section
    v-if="activeClusters.length > 0 || isLoading"
    class="dashboard-clusters"
    :aria-label="$t('dashboard.clusters.title') as string"
  >
    <h2 class="clusters-title text-sm text-tertiary label-caps">
      {{ $t('dashboard.clusters.title') }}
    </h2>

    <!-- Loading skeletons -->
    <div v-if="isLoading" class="clusters-grid">
      <LoadingShimmer v-for="i in 2" :key="i" variant="card" height="140px" />
    </div>

    <!-- Active cluster cards -->
    <div v-else class="clusters-grid">
      <ClusterCard
        v-for="cluster in activeClusters"
        :key="cluster.id"
        :cluster-id="cluster.id"
        :name="cluster.name"
        :pillar-name="cluster.pillarName"
      />
    </div>
  </section>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import ClusterCard from "src/components/cluster/ClusterCard.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import type { ClusterListEntry } from "src/types/ui";

/** API response envelope for the clusters list */
interface ClustersListResponse {
  items: ClusterListEntry[];
  total: number;
}

const ACTIVE_STATUSES = new Set(["running", "plan_proposed", "partial"]);

/**
 * Grid of actively-generating clusters.
 * Only visible when at least one cluster has generationStatus IN (running|plan_proposed|partial).
 * Each ClusterCard independently polls for live status via useClusterStatus.
 */
export default defineComponent({
  name: "DashboardClusters",

  components: { ClusterCard, LoadingShimmer },

  setup() {
    const projectStore = useProjectStore();

    const { data: clustersData, isLoading } = useQuery({
      queryKey: ["clusters-list", projectStore.currentSlug],
      queryFn: () =>
        apiGet<ClustersListResponse>(
          `/projects/${projectStore.currentSlug}/clusters?limit=50`,
        ),
      refetchInterval: 30_000,
      staleTime: 15_000,
    });

    return { clustersData, isLoading };
  },

  computed: {
    activeClusters(): ClusterListEntry[] {
      const items = this.clustersData?.items ?? [];
      return items.filter(
        (c) => c.generationStatus !== null && ACTIVE_STATUSES.has(c.generationStatus),
      );
    },
  },
});
</script>

<style scoped>
.dashboard-clusters {
  margin-bottom: var(--space-6);
}

.clusters-title {
  margin: 0 0 var(--space-4);
  color: var(--text-dim);
  letter-spacing: 0.06em;
}

.clusters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--space-3);
}

@media (max-width: 767px) {
  .clusters-grid {
    grid-template-columns: 1fr;
  }
}
</style>
