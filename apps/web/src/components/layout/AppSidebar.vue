<template>
  <nav class="app-sidebar" :class="{ open: open && isMobile }">
    <div class="sidebar-inner">
      <!-- === Orchestration section === -->
      <div class="nav-section">
        <p class="nav-section-label label-caps">{{ $t("nav.orchestration") }}</p>

        <!-- v-bind for badge: exactOptionalPropertyTypes forbids badge: number | undefined -->
        <NavItem
          :to="`/projects/${slug}/dashboard`"
          icon="dashboard"
          :label="$t('nav.dashboard') as string"
          v-bind="runningCount > 0 ? { badge: runningCount, badgeVariant: 'live' } : {}"
        />
      </div>

      <!-- === Planner section (62.5 + 62.6) === -->
      <div class="nav-section">
        <p class="nav-section-label label-caps">{{ $t("nav.plannerSection") as string }}</p>

        <NavItem
          :to="`/projects/${slug}/planner`"
          icon="planner"
          :label="$t('nav.planner') as string"
        />
        <NavItem
          :to="`/projects/${slug}/runs`"
          icon="runs"
          :label="$t('nav.pipelineRuns') as string"
        />
        <NavItem
          :to="`/projects/${slug}/optimization-requests`"
          icon="optimizationRequests"
          :label="$t('nav.optimizationRequests') as string"
        />
      </div>

      <!-- === Content section === -->
      <div class="nav-section">
        <p class="nav-section-label label-caps">{{ $t("nav.content") }}</p>

        <NavItem
          :to="`/projects/${slug}/clusters`"
          icon="clusters"
          :label="$t('nav.clusters') as string"
        />
        <NavItem
          :to="`/projects/${slug}/articles`"
          icon="articles"
          :label="$t('nav.articles') as string"
        />
        <NavItem
          :to="`/projects/${slug}/briefs`"
          icon="briefs"
          :label="$t('nav.briefs') as string"
        />
      </div>

      <!-- === Discovery section === -->
      <div class="nav-section">
        <p class="nav-section-label label-caps">{{ $t("nav.discovery") as string }}</p>

        <NavItem
          :to="`/projects/${slug}/trends`"
          icon="trends"
          :label="$t('nav.trends') as string"
          v-bind="trendsPending > 0 ? { badge: trendsPending, badgeVariant: 'default' } : {}"
        />
        <NavItem
          :to="`/projects/${slug}/refresh-queue`"
          icon="refreshQueue"
          :label="$t('nav.refreshQueue') as string"
          v-bind="refreshCandidates > 0 ? { badge: refreshCandidates, badgeVariant: 'default' } : {}"
        />
      </div>

      <!-- === Platform section === -->
      <div class="nav-section">
        <p class="nav-section-label label-caps">{{ $t("nav.platform") }}</p>

        <NavItem
          :to="`/projects/${slug}/costs`"
          icon="cost"
          :label="$t('nav.cost') as string"
        />
        <NavItem
          :to="`/projects/${slug}/settings`"
          icon="settings"
          :label="$t('nav.settings') as string"
        />
        <NavItem
          :to="`/projects/${slug}/article-tools`"
          icon="articleTools"
          :label="$t('nav.articleTools') as string"
        />
      </div>

      <!-- === Status filter chips (bottom, only on dashboard) === -->
      <div v-if="isDashboard" class="filter-section">
        <p class="nav-section-label label-caps">{{ $t("nav.filterAll") }}</p>
        <div class="filter-chips">
          <button
            v-for="f in statusFilters"
            :key="f.value"
            class="filter-chip"
            :class="{ 'filter-chip--active': activeFilter === f.value }"
            @click="setFilter(f.value)"
          >
            {{ $t(f.labelKey) as string }}
          </button>
        </div>
      </div>
    </div>
  </nav>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useUiStore } from "src/stores/ui";
import { useProjectStore } from "src/stores/project";
import { useDiscoveryCounts } from "src/composables/useDiscoveryCounts";
import NavItem from "./NavItem.vue";

type StatusFilter = "all" | "running" | "queued" | "failed" | "completed";

interface FilterOption {
  value: StatusFilter;
  labelKey: string;
}

const STATUS_FILTERS: FilterOption[] = [
  { value: "all", labelKey: "nav.filterAll" },
  { value: "running", labelKey: "nav.filterRunning" },
  { value: "queued", labelKey: "nav.filterQueued" },
  { value: "failed", labelKey: "nav.filterFailed" },
  { value: "completed", labelKey: "nav.filterCompleted" },
];

/**
 * Application sidebar — 240px desktop, overlay on mobile.
 * Three nav sections: Orchestration, Content, Platform.
 * Status filter chips at the bottom persist to ui store.
 */
export default defineComponent({
  name: "AppSidebar",

  components: { NavItem },

  props: {
    isMobile: { type: Boolean, default: false },
    open: { type: Boolean, default: false },
    runningCount: { type: Number, default: 0 },
  },

  emits: ["close"],

  setup() {
    const uiStore = useUiStore();
    const projectStore = useProjectStore();
    const { trendsPending, refreshCandidates } = useDiscoveryCounts();
    return { uiStore, projectStore, trendsPending, refreshCandidates };
  },

  computed: {
    slug(): string {
      return this.projectStore.currentSlug;
    },
    isDashboard(): boolean {
      return this.$route.name === "dashboard";
    },
    activeFilter(): StatusFilter {
      return this.uiStore.statusFilter;
    },
    statusFilters(): FilterOption[] {
      return STATUS_FILTERS;
    },
  },

  methods: {
    setFilter(filter: StatusFilter): void {
      this.uiStore.setStatusFilter(filter);
    },
  },
});
</script>

<style scoped>
.app-sidebar {
  background: var(--bg-glass);
  border-right: 1px solid var(--border-subtle);
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

.sidebar-inner {
  padding: var(--space-4) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  min-height: 100%;
}

/* Nav section */
.nav-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-section-label {
  padding: 0 var(--space-3);
  margin-bottom: var(--space-1);
  color: var(--text-dim);
}

/* Filter chips at bottom */
.filter-section {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 var(--space-1);
}

.filter-chip {
  padding: 4px 8px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 600;
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
              border-color var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
              color var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
}

@media (hover: hover) and (pointer: fine) {
  .filter-chip:hover {
    background: var(--bg-glass-strong);
    border-color: var(--border-soft);
    color: var(--text-secondary);
  }
}

.filter-chip:active {
  transform: scale(0.97);
  transition-duration: 160ms;
}

.filter-chip--active {
  background: rgba(124, 92, 255, 0.12);
  border-color: rgba(124, 92, 255, 0.3);
  color: var(--accent-primary);
}
</style>
