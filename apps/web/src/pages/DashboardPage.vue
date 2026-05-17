<template>
  <div class="dashboard-page">
    <!-- Main content area -->
    <div class="dashboard-main">
      <DashboardHeader
        @filter-last24h="onFilterLast24h"
        @open-filter="onOpenFilter"
      />
      <DashboardStats />

      <!-- Inline type-filter chip bar -->
      <div v-if="showFilter" class="filter-bar">
        <button
          v-for="chip in filterChips"
          :key="chip.type"
          class="filter-chip"
          :class="{ 'chip-active': activeTypeFilter.includes(chip.type) }"
          @click="toggleTypeFilter(chip.type)"
        >
          {{ chip.label }}
        </button>
        <button class="filter-chip chip-clear" @click="clearTypeFilter">
          {{ $t('common.clearFilters') as string }}
        </button>
      </div>

      <DashboardLanes
        :selected-run-id="selectedRunId"
        :type-filter="activeTypeFilter"
        :status-filter="uiStore.statusFilter"
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
        <PipelineRunDetail
          :key="selectedRunId ?? ''"
          :run-id="selectedRunId"
          :source="uiStore.selectedRunSource ?? 'pipeline_runs'"
        />
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

  data: () => ({
    showFilter: false,
    activeTypeFilter: [] as string[],
  }),

  computed: {
    selectedRunId(): string | null {
      return this.uiStore.selectedPipelineRunId;
    },
    filterChips(): Array<{ type: string; label: string }> {
      return [
        { type: "article_draft", label: this.$t("dashboard.pipeline.types.article_draft") as string },
        { type: "article_outline", label: this.$t("dashboard.pipeline.types.article_outline") as string },
        { type: "astro_sync", label: this.$t("dashboard.pipeline.types.astro_sync") as string },
        { type: "schema_extension", label: this.$t("dashboard.pipeline.types.schema_extension") as string },
        { type: "pagespeed", label: this.$t("dashboard.pipeline.types.pagespeed") as string },
        { type: "link_rebuild", label: this.$t("dashboard.pipeline.types.link_rebuild") as string },
        { type: "cold_start", label: this.$t("dashboard.pipeline.types.cold-start") as string },
      ];
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
    onSelectRun(payload: { id: string; source: string } | null): void {
      if (!payload) {
        this.uiStore.selectPipelineRun(null, null);
      } else {
        this.uiStore.selectPipelineRun(payload.id, payload.source as import("src/types/ui").ActivitySource);
      }
    },

    onFilterLast24h(): void {
      this.uiStore.setStatusFilter("completed");
    },

    onOpenFilter(): void {
      this.showFilter = !this.showFilter;
      if (!this.showFilter) this.activeTypeFilter = [];
    },

    toggleTypeFilter(type: string): void {
      const idx = this.activeTypeFilter.indexOf(type);
      if (idx === -1) {
        this.activeTypeFilter = [...this.activeTypeFilter, type];
      } else {
        this.activeTypeFilter = this.activeTypeFilter.filter((t) => t !== type);
      }
    },

    clearTypeFilter(): void {
      this.activeTypeFilter = [];
      this.showFilter = false;
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

/* Filter chip bar */
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: var(--space-4);
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 14px;
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              border-color 120ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              color 120ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.filter-chip.chip-active {
  background: color-mix(in oklch, var(--accent-primary) 15%, transparent);
  border-color: var(--accent-primary);
  color: var(--accent-primary);
}

.filter-chip.chip-clear {
  border-style: dashed;
  color: var(--text-tertiary);
}

@media (hover: hover) and (pointer: fine) {
  .filter-chip:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
  }

  .filter-chip.chip-active:hover {
    background: color-mix(in oklch, var(--accent-primary) 25%, transparent);
  }
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
