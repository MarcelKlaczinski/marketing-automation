<template>
  <q-btn-dropdown
    flat
    dense
    no-icon-animation
    hide-dropdown-icon
    class="project-selector"
    :ripple="false"
    :content-class="'project-dropdown-menu'"
  >
    <template #label>
      <div class="selector-label">
        <span
          class="selector-dot"
          :class="hasActivity ? 'dot-live' : 'dot-idle'"
        />
        <span class="selector-name text-sm">{{ currentName }}</span>
        <svg
          class="selector-chevron"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <polyline points="2,3.5 5,6.5 8,3.5" />
        </svg>
      </div>
    </template>

    <div class="dropdown-content">
      <!-- Loading skeleton -->
      <div v-if="isLoading" class="dropdown-loading">
        <div v-for="i in 2" :key="i" class="skeleton-row" />
      </div>

      <template v-else>
        <div
          v-for="project in projects"
          :key="project.slug"
          class="project-row"
          :class="{ 'project-row--active': project.slug === currentSlug }"
          role="menuitem"
          tabindex="0"
          @click="switchProject(project.slug)"
          @keydown.enter="switchProject(project.slug)"
          @keydown.space.prevent="switchProject(project.slug)"
        >
          <div class="project-row-info">
            <div class="project-row-name text-sm">{{ project.name }}</div>
            <div class="project-row-meta text-xs text-tertiary">
              {{ project.industry }}
            </div>
          </div>
          <div class="project-row-badges">
            <span
              v-if="project.activity.runningCount > 0"
              class="badge badge-live"
              :aria-label="$t('nav.runningCount', { n: project.activity.runningCount }) as string"
            >
              {{ project.activity.runningCount }}
            </span>
            <span
              v-if="project.activity.failedLast24h > 0"
              class="badge badge-urgent"
              :aria-label="$t('nav.failedCount', { n: project.activity.failedLast24h }) as string"
            >
              {{ project.activity.failedLast24h }}
            </span>
            <span class="cost-mini mono text-dim">
              €{{ project.stats.costThisMonthEur.toFixed(2) }}
            </span>
          </div>
        </div>
      </template>

      <div v-if="!isLoading && (projects ?? []).length === 0" class="dropdown-empty text-dim text-sm">
        {{ $t("nav.noProjects") }}
      </div>
    </div>
  </q-btn-dropdown>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import type { ProjectPickerEntry } from "src/types/ui";

/**
 * Project picker dropdown in the Topbar.
 * Fetches all projects via TanStack Query (refetches every 30s for live activity counts).
 * Clicking a project switches it in the store and navigates to its dashboard.
 */
export default defineComponent({
  name: "ProjectSelector",

  setup() {
    const projectStore = useProjectStore();

    const { data: projects, isLoading } = useQuery({
      queryKey: ["projects", "picker"],
      queryFn: () => apiGet<ProjectPickerEntry[]>("/projects/picker"),
      refetchInterval: 30_000,
    });

    return { projectStore, projects, isLoading };
  },

  computed: {
    currentSlug(): string {
      return this.projectStore.currentSlug;
    },
    currentProject(): ProjectPickerEntry | null {
      return (this.projects ?? []).find((p) => p.slug === this.currentSlug) ?? null;
    },
    currentName(): string {
      return this.currentProject?.name ?? this.currentSlug;
    },
    hasActivity(): boolean {
      return (this.currentProject?.activity.runningCount ?? 0) > 0;
    },
  },

  methods: {
    switchProject(slug: string): void {
      this.projectStore.setCurrentSlug(slug);
      void this.$router.push(`/projects/${slug}/dashboard`);
    },
  },
});
</script>

<style scoped>
/* Trigger button */
.project-selector {
  padding: 4px 8px;
  border-radius: var(--radius-md);
  transition: background var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
}

/* Hide Quasar's internal dropdown arrow — we render our own SVG chevron */
.project-selector :deep(.q-btn-dropdown__arrow) {
  display: none;
}

.selector-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
}

.selector-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-live {
  background: var(--status-running);
  box-shadow: 0 0 6px var(--accent-secondary-glow);
  animation: pulse 2s ease-in-out infinite;
}

.dot-idle {
  background: var(--border-medium);
}

.selector-name {
  font-weight: 500;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selector-chevron {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* Dropdown panel — applied via content-class */
:global(.project-dropdown-menu) {
  background: var(--bg-elevated) !important;
  backdrop-filter: var(--blur-glass);
  -webkit-backdrop-filter: var(--blur-glass);
  border: 1px solid var(--border-soft) !important;
  border-radius: var(--radius-lg) !important;
  box-shadow: var(--shadow-elevated) !important;
  min-width: 240px;
  padding: 6px;
  margin-top: 6px;
}

.dropdown-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Project row */
.project-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
  outline: none;
}

@media (hover: hover) and (pointer: fine) {
  .project-row:hover {
    background: var(--bg-glass-strong);
  }
}

.project-row:focus-visible {
  background: var(--bg-glass-strong);
}

.project-row--active {
  background: rgba(124, 92, 255, 0.08);
}

.project-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.project-row-name {
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-row-badges {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* Activity badges */
.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 9px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.badge-live {
  background: var(--status-running-bg);
  color: var(--status-running);
  border: 1px solid rgba(0, 212, 255, 0.2);
}

.badge-urgent {
  background: var(--status-failed-bg);
  color: var(--status-failed);
  border: 1px solid rgba(255, 77, 109, 0.2);
}

.cost-mini {
  font-size: 10px;
  white-space: nowrap;
}

/* Loading skeleton */
.dropdown-loading {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
}

.skeleton-row {
  height: 44px;
  border-radius: var(--radius-md);
  background: linear-gradient(
    90deg,
    var(--bg-glass) 25%,
    var(--bg-glass-strong) 50%,
    var(--bg-glass) 75%
  );
  background-size: 400px 100%;
  animation: shimmerPass 1.4s ease-in-out infinite;
}

.dropdown-empty {
  padding: 12px 10px;
  text-align: center;
}
</style>
