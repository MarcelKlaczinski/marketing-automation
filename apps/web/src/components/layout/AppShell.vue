<template>
  <div class="app-shell" :class="{ 'mobile-mode': isMobile, 'sidebar-open': sidebarOpen }">
    <!-- Topbar (Session 2) -->
    <header class="app-topbar">
      <div class="topbar-inner">
        <button
          v-if="isMobile"
          class="topbar-hamburger"
          :aria-label="$t('nav.openMenu') as string"
          @click="uiStore.toggleSidebar()"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="2" y1="5" x2="16" y2="5" />
            <line x1="2" y1="9" x2="16" y2="9" />
            <line x1="2" y1="13" x2="16" y2="13" />
          </svg>
        </button>
        <span class="topbar-logo text-gradient-accent mono">MA</span>
        <span class="topbar-separator" />
        <span class="topbar-project text-secondary text-sm">
          {{ projectSlug }}
        </span>
      </div>
    </header>

    <!-- Sidebar (Session 2) -->
    <nav
      class="app-sidebar"
      :class="{ 'sidebar-visible': !isMobile || sidebarOpen }"
      @click.self="uiStore.closeSidebar()"
    >
      <div class="sidebar-inner">
        <!-- Placeholder nav — full implementation in Session 2 -->
        <p class="label-caps text-tertiary" style="padding: 16px 12px;">
          Navigation (Session 2)
        </p>
      </div>
    </nav>

    <!-- Mobile sidebar backdrop -->
    <div
      v-if="isMobile && sidebarOpen"
      class="sidebar-backdrop"
      @click="uiStore.closeSidebar()"
    />

    <!-- Main content area -->
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
import { useUiStore } from "src/stores/ui";
import { useProjectStore } from "src/stores/project";

/**
 * Root layout shell. Grid: topbar + sidebar + main.
 * Responsive: on mobile, sidebar becomes an overlay drawer.
 * Full AppTopbar and AppSidebar components added in Session 2.
 */
export default defineComponent({
  name: "AppShell",

  setup() {
    const uiStore = useUiStore();
    const projectStore = useProjectStore();
    return { uiStore, projectStore };
  },

  data: () => ({
    /** True when viewport width < 768px */
    isMobile: window.innerWidth < 768,
    resizeHandler: null as (() => void) | null,
  }),

  computed: {
    sidebarOpen(): boolean {
      return this.uiStore.sidebarOpen;
    },
    projectSlug(): string {
      return this.projectStore.currentSlug;
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
    if (this.resizeHandler) window.removeEventListener("resize", this.resizeHandler);
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
}

/* === Topbar === */
.app-topbar {
  grid-area: topbar;
  display: flex;
  align-items: center;
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-glass-light);
  -webkit-backdrop-filter: var(--blur-glass-light);
  border-bottom: 1px solid var(--border-subtle);
  position: relative;
  z-index: var(--z-sticky);
}

.topbar-inner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-5);
  width: 100%;
}

.topbar-hamburger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
              color var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
}

@media (hover: hover) and (pointer: fine) {
  .topbar-hamburger:hover {
    background: var(--bg-glass-strong);
    color: var(--text-primary);
  }
}

.topbar-logo {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.topbar-separator {
  width: 1px;
  height: 16px;
  background: var(--border-subtle);
}

/* === Sidebar === */
.app-sidebar {
  grid-area: sidebar;
  background: var(--bg-glass);
  border-right: 1px solid var(--border-subtle);
  overflow-y: auto;
  overflow-x: hidden;
}

/* === Main === */
.app-main {
  grid-area: main;
  overflow: hidden;
  position: relative;
}

/* === Mobile overrides === */
.mobile-mode {
  grid-template-columns: 1fr;
  grid-template-areas:
    "topbar"
    "main";
}

.mobile-mode .app-sidebar {
  position: fixed;
  top: var(--topbar-height);
  left: 0;
  bottom: 0;
  width: var(--sidebar-width);
  z-index: var(--z-overlay);
  transform: translateX(-100%);
  transition: transform 300ms cubic-bezier(0.32, 0.72, 0, 1);
}

.mobile-mode .app-sidebar.sidebar-visible {
  transform: translateX(0);
}

.sidebar-backdrop {
  position: fixed;
  inset: 0;
  top: var(--topbar-height);
  background: rgba(0, 0, 0, 0.5);
  z-index: calc(var(--z-overlay) - 1);
  animation: fadeInUp 200ms ease backwards;
}
</style>
