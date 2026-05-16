<template>
  <div class="app-shell" :class="{ 'mobile-mode': isMobile }">
    <!-- Topbar -->
    <AppTopbar :is-mobile="isMobile" @toggle-sidebar="uiStore.toggleSidebar()" />

    <!-- Sidebar -->
    <AppSidebar
      :is-mobile="isMobile"
      :open="uiStore.sidebarOpen"
      :running-count="runningCount"
      :failed-count="failedCount"
      @close="uiStore.closeSidebar()"
    />

    <!-- Mobile sidebar backdrop -->
    <div
      v-if="isMobile && uiStore.sidebarOpen"
      class="sidebar-backdrop"
      aria-hidden="true"
      @click="uiStore.closeSidebar()"
    />

    <!-- Main content -->
    <main class="app-main">
      <router-view v-slot="{ Component, route }">
        <transition name="page-fade" mode="out-in">
          <component :is="Component" :key="route.fullPath" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useUiStore } from "src/stores/ui";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import AppTopbar from "./AppTopbar.vue";
import AppSidebar from "./AppSidebar.vue";

interface ActivitySummary {
  runningCount: number;
  failedLast24h: number;
}

/**
 * Root layout shell.
 * Grid: topbar (top-span) / sidebar (left) / main (right).
 * Responsive: < 768px → sidebar overlays as a drawer.
 * Activity counts (running/failed) fetched via TanStack Query + SSE invalidation.
 */
export default defineComponent({
  name: "AppShell",

  components: { AppTopbar, AppSidebar },

  setup() {
    const uiStore = useUiStore();
    const projectStore = useProjectStore();

    const { data: activityData } = useQuery({
      queryKey: ["activity-summary", projectStore.currentSlug],
      queryFn: () =>
        apiGet<ActivitySummary>(
          `/projects/${projectStore.currentSlug}/activity-summary`,
        ),
      refetchInterval: 60_000,
    });

    return { uiStore, projectStore, activityData };
  },

  data: () => ({
    isMobile: window.innerWidth < 768,
    resizeHandler: null as (() => void) | null,
  }),

  computed: {
    runningCount(): number {
      return this.activityData?.runningCount ?? 0;
    },
    failedCount(): number {
      return this.activityData?.failedLast24h ?? 0;
    },
  },

  mounted(): void {
    this.resizeHandler = () => {
      this.isMobile = window.innerWidth < 768;
      if (!this.isMobile) this.uiStore.closeSidebar();
    };
    window.addEventListener("resize", this.resizeHandler);
  },

  unmounted(): void {
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
    }
  },
});
</script>

<style scoped>
/* === Grid layout === */
.app-shell {
  height: 100vh;
  display: grid;
  grid-template-rows: var(--topbar-height) 1fr;
  grid-template-columns: var(--sidebar-width) 1fr;
  grid-template-areas:
    "topbar topbar"
    "sidebar main";
  overflow: hidden;
  position: relative;
}

/* === Topbar (row 1, spans both columns) === */
:deep(.app-topbar) {
  grid-area: topbar;
}

/* === Sidebar (row 2, col 1) === */
:deep(.app-sidebar) {
  grid-area: sidebar;
}

/* === Main (row 2, col 2) === */
.app-main {
  grid-area: main;
  overflow: hidden;
  position: relative;
}

/* === Mobile overrides (< 768px) === */
.mobile-mode {
  grid-template-columns: 1fr;
  grid-template-areas:
    "topbar"
    "main";
}

/* Mobile sidebar: fixed overlay drawer */
.mobile-mode :deep(.app-sidebar) {
  position: fixed;
  top: var(--topbar-height);
  left: 0;
  bottom: 0;
  width: var(--sidebar-width);
  z-index: var(--z-overlay);
  transform: translateX(-100%);
  transition: transform 300ms cubic-bezier(0.32, 0.72, 0, 1);
}

.mobile-mode :deep(.app-sidebar.open) {
  transform: translateX(0);
}

/* Backdrop behind mobile sidebar */
.sidebar-backdrop {
  position: fixed;
  inset: 0;
  top: var(--topbar-height);
  background: rgba(0, 0, 0, 0.5);
  z-index: calc(var(--z-overlay) - 1);
  animation: fadeInUp 200ms cubic-bezier(0.4, 0, 0.2, 1) backwards;
}

/* Page route transitions */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1));
}

.page-fade-enter-from,
.page-fade-leave-to {
  opacity: 0;
}
</style>
