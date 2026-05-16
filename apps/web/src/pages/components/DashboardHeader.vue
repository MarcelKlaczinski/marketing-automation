<template>
  <header class="dashboard-header">
    <!-- Left: title + live indicator -->
    <div class="header-left">
      <h1 class="dashboard-title">{{ $t('dashboard.title') }}</h1>
      <LiveIndicator v-if="runningCount > 0" />
    </div>

    <!-- Center: status summary -->
    <p v-if="!isLoading" class="header-status text-sm text-tertiary">
      {{ $t('dashboard.liveStatus', {
        running: runningCount,
        queued: queuedCount,
        cost: todayCostDisplay,
      }) }}
    </p>
    <LoadingShimmer v-else variant="line" height="14px" width="200px" />

    <!-- Right: quick filter buttons -->
    <div class="header-actions">
      <GlassButton variant="ghost" @click="$emit('filterLast24h')">
        {{ $t('dashboard.filter.last24h') }}
      </GlassButton>
      <GlassButton variant="ghost" @click="$emit('openFilter')">
        {{ $t('dashboard.filter.filter') }}
      </GlassButton>
    </div>
  </header>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useProjectContext } from "src/composables/useProjectContext";
import { useCostSummary } from "src/composables/useCostSummary";
import LiveIndicator from "src/components/ui/LiveIndicator.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";

/**
 * Dashboard page header — gradient title, LIVE indicator, status summary.
 * Data: running/queued counts from project picker cache + today's cost.
 */
export default defineComponent({
  name: "DashboardHeader",

  components: { LiveIndicator, GlassButton, LoadingShimmer },

  emits: ["filterLast24h", "openFilter"],

  setup() {
    const { runningCount, failedCount, isLoading } = useProjectContext();
    // useCostSummary accepts a plain string (MaybeRef) — no ref() needed here
    const todaySummary = useCostSummary("today");
    return { runningCount, failedCount, isLoading, todaySummary };
  },

  data: () => ({
    // Queued count placeholder — project picker doesn't expose this directly.
    // Will be wired to useActivityFeed data in a later session.
    queuedCount: 0,
  }),

  computed: {
    todayCostDisplay(): string {
      const cost = this.todaySummary.data?.value?.totalEur ?? 0;
      return cost.toFixed(2);
    },
  },
});
</script>

<style scoped>
.dashboard-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-6);
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: 1;
  min-width: 0;
}

.dashboard-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.025em;
  background: linear-gradient(135deg, var(--text-primary) 0%, var(--text-secondary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.header-status {
  margin: 0;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}
</style>
