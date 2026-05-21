<template>
  <div class="app-shell" :class="{ 'mobile-mode': isMobile }">
    <!-- Topbar -->
    <AppTopbar :is-mobile="isMobile" @toggle-sidebar="uiStore.toggleSidebar()" />

    <!-- Sidebar -->
    <AppSidebar
      :is-mobile="isMobile"
      :open="uiStore.sidebarOpen"
      :running-count="runningCount"
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

    <!-- Command palette — global modal, triggered by ⌘K -->
    <CommandPalette />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useUiStore } from "src/stores/ui";
import { useProjectStore } from "src/stores/project";
import { useKeyboardShortcuts } from "src/composables/useKeyboardShortcuts";
import { apiGet } from "src/lib/api";
import AppTopbar from "./AppTopbar.vue";
import AppSidebar from "./AppSidebar.vue";
import CommandPalette from "src/components/search/CommandPalette.vue";

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

  components: { AppTopbar, AppSidebar, CommandPalette },

  setup() {
    const uiStore = useUiStore();
    const projectStore = useProjectStore();

    // Global keyboard shortcuts: ⌘K (command palette) + Escape — wired here so they
    // work on all child pages, not just DashboardPage.
    useKeyboardShortcuts();

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
    isMobile: globalThis.innerWidth < 768,
    resizeHandler: null as (() => void) | null,
  }),

  computed: {
    runningCount(): number {
      return this.activityData?.runningCount ?? 0;
    },
  },

  mounted(): void {
    this.resizeHandler = () => {
      this.isMobile = globalThis.innerWidth < 768;
      if (!this.isMobile) this.uiStore.closeSidebar();
    };
    globalThis.addEventListener("resize", this.resizeHandler);
  },

  unmounted(): void {
    if (this.resizeHandler) {
      globalThis.removeEventListener("resize", this.resizeHandler);
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

/* === Main (row 2, col 2) ===
   Single scroll-context for the entire app. Pages flow naturally inside
   without needing their own `overflow-y: auto` — keyboard focus follows
   the native browser scroll, links + anchors work end-to-end, and the
   command palette / dialogs sit on top via fixed positioning. */
.app-main {
  grid-area: main;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  /* Smooth scroll for in-page anchor jumps; respects prefers-reduced-motion. */
  scroll-behavior: smooth;
}

@media (prefers-reduced-motion: reduce) {
  .app-main {
    scroll-behavior: auto;
  }
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
