<template>
  <div class="dashboard-page">
    <!-- Main content area -->
    <div class="dashboard-main">
      <DashboardHeader
        @filter-last24h="onFilterLast24h"
        @open-filter="onOpenFilter"
      />
      <DashboardStats />
      <DashboardLanes
        :selected-run-id="selectedRunId"
        @select="onSelectRun"
      />
      <DashboardClusters />
    </div>

    <!-- Detail pane — always present on desktop, slide-in on mobile -->
    <div
      class="dashboard-detail"
      :class="{ 'detail-visible': detailPaneVisible }"
      :aria-hidden="!detailPaneVisible"
    >
      <div v-if="selectedRunId" class="detail-content">
        <button
          v-if="isMobile"
          class="detail-back text-sm"
          :aria-label="$t('common.back') as string"
          @click="onSelectRun(null)"
        >
          ← {{ $t('common.back') }}
        </button>
        <PipelineRunDetail :run-id="selectedRunId" />
      </div>

      <div v-else class="detail-empty">
        <EmptyState
          icon="📋"
          :title="$t('dashboard.detail.noSelection') as string"
          :description="$t('dashboard.detail.noSelectionDesc') as string"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useUiStore } from "src/stores/ui";
import { usePipelineEvents } from "src/composables/usePipelineEvents";
import { useResponsiveLayout } from "src/composables/useResponsiveLayout";
import DashboardHeader from "./components/DashboardHeader.vue";
import DashboardStats from "./components/DashboardStats.vue";
import DashboardLanes from "./components/DashboardLanes.vue";
import DashboardClusters from "./components/DashboardClusters.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import PipelineRunDetail from "src/components/pipeline/PipelineRunDetail.vue";

/**
 * Pipeline orchestration dashboard — root view of Spec 56.1.
 * Layout: 2-column grid (main | detail pane) on desktop,
 *         stacked with slide-in detail on mobile.
 *
 * Manages:
 * - SSE connection for real-time pipeline events (usePipelineEvents)
 * - Global keyboard shortcuts (useKeyboardShortcuts)
 * - Detail pane visibility (uiStore.selectedPipelineRunId)
 */
export default defineComponent({
  name: "DashboardPage",

  components: {
    DashboardHeader,
    DashboardStats,
    DashboardLanes,
    DashboardClusters,
    EmptyState,
    PipelineRunDetail,
  },

  setup() {
    const uiStore = useUiStore();
    const { isMobile } = useResponsiveLayout();

    // Establish SSE connection for the duration of this page mount.
    usePipelineEvents();

    return { uiStore, isMobile };
  },

  computed: {
    selectedRunId(): string | null {
      return this.uiStore.selectedPipelineRunId;
    },

    detailPaneVisible(): boolean {
      if (this.isMobile) {
        return !!this.selectedRunId && this.uiStore.detailPaneOpen;
      }
      // Desktop: always show the pane (empty state when nothing selected)
      return this.uiStore.detailPaneOpen;
    },
  },

  methods: {
    onSelectRun(runId: string | null): void {
      this.uiStore.selectPipelineRun(runId);
    },

    onFilterLast24h(): void {
      this.uiStore.setStatusFilter("completed");
    },

    onOpenFilter(): void {
      // no-op — filter panel deferred to Phase E
    },
  },
});
</script>

<style scoped>
.dashboard-page {
  height: 100%;
  display: grid;
  grid-template-columns: 1fr var(--detail-pane-width);
  gap: 1px;
  background: var(--border-subtle);
  overflow: hidden;
}

.dashboard-main {
  background: var(--bg-base);
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px 28px;
}

.dashboard-detail {
  background: var(--bg-base);
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px;
  border-left: 1px solid var(--border-subtle);
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.detail-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Back button (mobile only) */
.detail-back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  background: none;
  border: none;
  color: var(--accent-primary);
  cursor: pointer;
  font-family: var(--font-sans);
  font-weight: 500;
}

/* === Mobile layout === */
@media (max-width: 1023px) {
  .dashboard-page {
    grid-template-columns: 1fr;
  }

  .dashboard-detail {
    position: fixed;
    inset: var(--topbar-height) 0 0 0;
    width: 100%;
    max-width: 480px;
    left: auto;
    right: 0;
    z-index: var(--z-overlay);
    transform: translateX(100%);
    transition: transform var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1));
    background: var(--bg-elevated);
    backdrop-filter: var(--blur-glass);
    -webkit-backdrop-filter: var(--blur-glass);
    border-left: 1px solid var(--border-soft);
  }

  .dashboard-detail.detail-visible {
    transform: translateX(0);
  }
}

@media (max-width: 767px) {
  .dashboard-main {
    padding: 16px;
  }
}
</style>
