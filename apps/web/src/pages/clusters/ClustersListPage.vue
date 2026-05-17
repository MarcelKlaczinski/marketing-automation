<template>
  <div class="clusters-page">
    <aside class="list-pane">
      <FilterBar
        :available-filters="availableFilters"
        :active-filters="activeFilters"
        :search="searchQuery"
        @update:filters="onFiltersChange"
        @update:search="onSearchChange"
      />

      <div class="list-content">
        <LoadingShimmer v-if="isLoading && !clusters.length" variant="card" :count="4" />
        <EmptyState
          v-else-if="!clusters.length && !isLoading"
          :title="$t('clusters.list.empty') as string"
          :description="$t('clusters.list.emptyDescription') as string"
        />
        <div
          v-for="cluster in clusters"
          :key="cluster.id"
          class="cluster-list-item"
          :class="{ 'cluster-selected': cluster.id === selectedClusterId }"
          role="button"
          tabindex="0"
          @click="onSelectCluster(cluster.id)"
          @keydown.enter="onSelectCluster(cluster.id)"
        >
          <ClusterCard
            :cluster-id="cluster.id"
            :name="cluster.name"
            :pillar-name="cluster.pillarName"
          />
        </div>

        <div ref="loadMoreSentinel" class="load-more-sentinel" />
      </div>
    </aside>

    <!-- Clusters use full-page detail, not master-detail pane -->
    <main class="detail-pane">
      <EmptyState
        :title="$t('clusters.list.empty') as string"
        :description="$t('clusters.list.emptyDescription') as string"
      />
    </main>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useClustersList } from "src/composables/useClustersList";
import type { ClustersListFilters } from "src/composables/useClustersList";
import FilterBar from "src/components/ui/FilterBar.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import ClusterCard from "src/components/cluster/ClusterCard.vue";

export default defineComponent({
  name: "ClustersListPage",

  components: {
    FilterBar,
    LoadingShimmer,
    EmptyState,
    ClusterCard,
  },

  setup() {
    const list = useClustersList();
    return {
      clusters: list.clusters,
      hasMore: list.hasMore,
      isLoading: list.isLoading,
      isFetchingMore: list.isFetchingMore,
      loadMore: list.loadMore,
      setFilters: list.setFilters,
    };
  },

  data: () => ({
    activeFilters: {} as Record<string, string>,
    searchQuery: "",
    _observer: null as IntersectionObserver | null,
  }),

  computed: {
    selectedClusterId(): string | null {
      return null; // Clusters navigate to full-page detail, not master-detail pane
    },
    availableFilters() {
      return [
        {
          key: "status",
          label: this.$t("clusters.list.filters.status") as string,
          options: [
            { value: "proposed", label: this.$t("clusters.generationStatus.proposed") as string },
            { value: "plan_proposed", label: this.$t("clusters.generationStatus.plan_proposed") as string },
            { value: "running", label: this.$t("clusters.generationStatus.running") as string },
            { value: "completed", label: this.$t("clusters.generationStatus.completed") as string },
            { value: "partial", label: this.$t("clusters.generationStatus.partial") as string },
            { value: "failed", label: this.$t("clusters.generationStatus.failed") as string },
          ],
        },
      ];
    },
  },

  mounted(): void {
    const sentinel = this.$refs.loadMoreSentinel as Element | undefined;
    if (!sentinel) return;
    this._observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && this.hasMore && !this.isFetchingMore) {
          this.loadMore();
        }
      },
      { rootMargin: "200px" },
    );
    this._observer.observe(sentinel);
  },

  beforeUnmount(): void {
    this._observer?.disconnect();
  },

  methods: {
    onFiltersChange(newFilters: Record<string, string>): void {
      this.activeFilters = newFilters;
      const f: ClustersListFilters = {};
      if (newFilters.status) f.generationStatus = newFilters.status;
      if (this.searchQuery) f.search = this.searchQuery;
      this.setFilters(f);
    },
    onSearchChange(search: string): void {
      this.searchQuery = search;
      const f: ClustersListFilters = {};
      if (this.activeFilters.status) f.generationStatus = this.activeFilters.status;
      if (search) f.search = search;
      this.setFilters(f);
    },
    onSelectCluster(id: string): void {
      const slug = this.$route.params.slug as string;
      void this.$router.push(`/projects/${slug}/clusters/${id}`);
    },
  },
});
</script>

<style scoped>
.clusters-page {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.list-pane {
  width: 360px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
  overflow: hidden;
}

.list-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-pane {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cluster-list-item {
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: outline 100ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.cluster-selected {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.load-more-sentinel {
  height: 1px;
}

@media (max-width: 767px) {
  .clusters-page {
    flex-direction: column;
  }

  .list-pane {
    width: 100%;
    max-height: 60vh;
  }
}
</style>
