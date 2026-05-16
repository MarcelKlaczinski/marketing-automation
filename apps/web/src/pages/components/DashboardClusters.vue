<template>
  <!-- Session 6 stub — ClusterCard + ClusterArticlePills implemented in next session -->
  <section class="dashboard-clusters">
    <h2 class="clusters-title text-sm text-tertiary label-caps">
      {{ $t('dashboard.clusters.title') }}
    </h2>
    <div class="clusters-placeholder">
      <EmptyState
        icon="🔗"
        :title="$t('dashboard.clusters.empty') as string"
        :description="$t('dashboard.clusters.emptyDesc') as string"
      />
    </div>
  </section>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import EmptyState from "src/components/ui/EmptyState.vue";

/**
 * Cluster grid — stub for Session 6.
 * Will render ClusterCard + ClusterArticlePills per active cluster.
 */
export default defineComponent({
  name: "DashboardClusters",
  components: { EmptyState },
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

.clusters-placeholder {
  background: var(--bg-glass);
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
  min-height: 120px;
}
</style>
