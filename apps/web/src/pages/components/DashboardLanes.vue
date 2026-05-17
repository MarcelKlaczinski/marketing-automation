<template>
  <section class="dashboard-lanes" :aria-label="$t('nav.dashboard') as string">
    <!-- Loading skeletons -->
    <template v-if="isLoading">
      <div v-for="i in 4" :key="i" class="lane-skeleton">
        <LoadingShimmer variant="line" height="20px" width="80px" />
        <LoadingShimmer variant="card" />
        <LoadingShimmer variant="card" />
      </div>
    </template>

    <template v-else>
      <PipelineStatusLane
        v-for="laneStatus in laneOrder"
        :key="laneStatus"
        :status="laneStatus"
        :count="runsByLane[laneStatus].length"
        :runs="runsByLane[laneStatus]"
        :selected-run-id="selectedRunId"
        @select="$emit('select', $event)"
      />
    </template>
  </section>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { useActivityFeed } from "src/composables/useActivityFeed";
import PipelineStatusLane from "src/components/pipeline/PipelineStatusLane.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import type { PipelineRunSummary, PipelineStatus } from "src/types/ui";

const LANE_ORDER: PipelineStatus[] = ["running", "queued", "failed", "completed"];
const MAX_COMPLETED = 20;

/**
 * 4-column kanban board — one PipelineStatusLane per status.
 * Data source: useActivityFeed(). Groups runs by status client-side.
 * Completed lane is capped at 20 to keep the DOM lean.
 */
export default defineComponent({
  name: "DashboardLanes",

  components: { PipelineStatusLane, LoadingShimmer },

  emits: ["select"],

  props: {
    selectedRunId: {
      type: String as PropType<string | null>,
      default: null,
    },
    typeFilter: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
  },

  setup() {
    const { data: feedData, isLoading } = useActivityFeed();
    return { feedData, isLoading };
  },

  computed: {
    laneOrder(): PipelineStatus[] {
      return LANE_ORDER;
    },

    filteredRuns(): PipelineRunSummary[] {
      const runs = (this.feedData ?? []) as PipelineRunSummary[];
      if (!this.typeFilter.length) return runs;
      return runs.filter((r) => this.typeFilter.includes(r.type));
    },
    runsByLane(): Record<PipelineStatus, PipelineRunSummary[]> {
      const runs = this.filteredRuns;
      return {
        running: runs.filter((r) => r.status === "running"),
        queued: runs.filter((r) => r.status === "queued"),
        failed: runs.filter((r) => r.status === "failed"),
        completed: runs
          .filter((r) => r.status === "completed")
          .slice(0, MAX_COMPLETED),
        cancelled: [],
      };
    },
  },
});
</script>

<style scoped>
.dashboard-lanes {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

/* Mobile: horizontal scroll snap */
@media (max-width: 767px) {
  .dashboard-lanes {
    display: flex;
    gap: var(--space-3);
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding-bottom: var(--space-2);
    /* Hide scrollbar but keep scroll */
    scrollbar-width: none;
  }

  .dashboard-lanes::-webkit-scrollbar {
    display: none;
  }
}

/* Loading skeletons */
.lane-skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
</style>
