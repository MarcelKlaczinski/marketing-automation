<template>
  <div class="pipeline-lane">
    <!-- Lane header -->
    <div class="lane-header">
      <div class="lane-title-row">
        <span class="lane-dot" :class="`dot-${status}`" aria-hidden="true" />
        <h3 class="lane-title text-sm">{{ laneLabel }}</h3>
      </div>
      <span class="lane-count mono text-xs text-dim">{{ count }}</span>
    </div>

    <!-- Cards -->
    <div class="lane-body">
      <TransitionGroup name="card-list" tag="div" class="lane-cards">
        <PipelineCard
          v-for="run in runs"
          :key="run.id"
          :run="run"
          :selected="selectedRunId === run.id"
          @select="$emit('select', $event)"
        />
      </TransitionGroup>

      <!-- Empty state -->
      <div v-if="runs.length === 0" class="lane-empty">
        <span class="text-xs text-dim">{{ $t('dashboard.lanes.empty') }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import PipelineCard from "./PipelineCard.vue";
import type { PipelineRunSummary, PipelineStatus } from "src/types/ui";

const LANE_LABELS: Record<string, string> = {
  queued: "dashboard.lanes.queued",
  running: "dashboard.lanes.running",
  failed: "dashboard.lanes.failed",
  completed: "dashboard.lanes.completed",
};

/**
 * One column of the kanban board. Renders a header (label + count) and
 * a scrollable list of PipelineCard items for that status.
 * TransitionGroup animates cards entering/leaving each lane.
 */
export default defineComponent({
  name: "PipelineStatusLane",

  components: { PipelineCard },

  emits: ["select"],

  props: {
    status: {
      type: String as PropType<PipelineStatus>,
      required: true,
    },
    count: {
      type: Number,
      default: 0,
    },
    runs: {
      type: Array as PropType<PipelineRunSummary[]>,
      default: () => [] as PipelineRunSummary[],
    },
    selectedRunId: {
      type: String as PropType<string | null>,
      default: null,
    },
  },

  computed: {
    laneLabel(): string {
      const key = LANE_LABELS[this.status];
      return key ? (this.$t(key) as string) : this.status;
    },
  },
});
</script>

<style scoped>
/* === Lane container === */
.pipeline-lane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: var(--space-3);
}

/* Mobile: snap each lane into view */
@media (max-width: 767px) {
  .pipeline-lane {
    min-width: calc(100vw - 48px);
    flex-shrink: 0;
    scroll-snap-align: start;
  }
}

/* === Header === */
.lane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-1);
}

.lane-title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.lane-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-queued   { background: var(--status-queued); }
.dot-running  { background: var(--status-running); box-shadow: 0 0 6px var(--accent-secondary-glow); }
.dot-failed   { background: var(--status-failed); }
.dot-completed { background: var(--status-success); }

.lane-title {
  margin: 0;
  font-weight: 600;
  color: var(--text-secondary);
}

.lane-count {
  min-width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-subtle);
  padding: 0 5px;
}

/* === Cards list === */
.lane-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  max-height: calc(100vh - 360px);
  min-height: 80px;
}

.lane-cards {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.lane-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 80px;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
}

/* === Card list transitions === */
.card-list-enter-active,
.card-list-leave-active {
  transition: opacity var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1)),
              transform var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1));
}

.card-list-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}

.card-list-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
