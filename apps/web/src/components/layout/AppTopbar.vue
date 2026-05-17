<template>
  <header class="app-topbar">
    <!-- Left: hamburger (mobile) + logo + project selector -->
    <div class="topbar-left">
      <button
        v-if="isMobile"
        class="icon-btn topbar-hamburger"
        :aria-label="$t('nav.openMenu') as string"
        @click="$emit('toggle-sidebar')"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <line x1="2" y1="5" x2="16" y2="5" />
          <line x1="2" y1="9" x2="16" y2="9" />
          <line x1="2" y1="13" x2="16" y2="13" />
        </svg>
      </button>

      <div class="topbar-logo" aria-hidden="true">
        <span class="logo-text mono">MA</span>
      </div>

      <div class="topbar-divider" />

      <ProjectSelector />
    </div>

    <!-- Right: Cmd+K button + notifications + avatar -->
    <div class="topbar-right">
      <!-- Command palette trigger -->
      <button
        class="cmd-btn"
        :aria-label="$t('nav.commandPalette') as string"
        @click="uiStore.toggleCommandPalette()"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <circle cx="6" cy="6" r="4" />
          <line x1="9" y1="9" x2="13" y2="13" />
        </svg>
        <span class="cmd-label text-sm text-tertiary">{{ $t("nav.search") }}</span>
        <kbd class="cmd-kbd mono">⌘K</kbd>
      </button>

      <!-- Notifications bell + dropdown -->
      <div class="notif-wrapper">
        <button
          class="icon-btn notif-btn"
          :aria-label="$t('notifications.title') as string"
          @click="toggleNotifications"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <path d="M8 1.5a5 5 0 0 1 5 5v2.5l1 2H1l1-2V6.5a5 5 0 0 1 5-5z" />
            <path d="M6 13.5a2 2 0 0 0 4 0" />
          </svg>
          <span v-if="unreadCount > 0" class="notif-badge" :aria-label="`${unreadCount}`">
            {{ unreadCount > 9 ? "9+" : unreadCount }}
          </span>
        </button>

        <!-- Backdrop (closes dropdown on outside click) -->
        <div
          v-if="notificationsOpen"
          class="notif-backdrop"
          @click="notificationsOpen = false"
        />

        <!-- Dropdown panel -->
        <div v-if="notificationsOpen" class="notif-dropdown" role="dialog" :aria-label="$t('notifications.title') as string">
          <div class="notif-header">
            <span class="notif-title text-sm">{{ $t('notifications.title') }}</span>
            <button
              v-if="unreadCount > 0"
              class="notif-mark-read text-sm"
              @click="markAllRead"
            >
              {{ $t('notifications.markAllRead') }}
            </button>
          </div>

          <div v-if="isLoadingNotifications" class="notif-loading">
            <div v-for="i in 3" :key="i" class="notif-skeleton" />
          </div>

          <div v-else-if="notificationItems.length === 0" class="notif-empty text-sm">
            {{ $t('notifications.empty') }}
          </div>

          <ul v-else class="notif-list">
            <li
              v-for="notif in notificationItems"
              :key="notif.id"
              class="notif-item"
              :class="{ 'notif-item--unread': !notif.readAt }"
            >
              <div class="notif-item-dot" :class="`dot--${notif.severity}`" />
              <div class="notif-item-body">
                <p class="notif-item-title text-sm">{{ notif.title }}</p>
                <p class="notif-item-msg text-xs text-tertiary">{{ notif.message }}</p>
                <p class="notif-item-time text-xs text-dim">{{ relativeTime(notif.createdAt) }}</p>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <!-- User avatar -->
      <button
        class="avatar-btn"
        :aria-label="userEmail"
        :title="userEmail"
      >
        <span class="avatar-initials">{{ initials }}</span>
      </button>
    </div>
  </header>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useUiStore } from "src/stores/ui";
import { useAuthStore } from "src/stores/auth";
import { apiGet, apiPost } from "src/lib/api";
import ProjectSelector from "./ProjectSelector.vue";

interface NotificationItem {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

/**
 * Application topbar — 56px height.
 * Left: hamburger (mobile), logo, project selector.
 * Right: Cmd+K search trigger, notification bell, user avatar.
 */
export default defineComponent({
  name: "AppTopbar",

  components: { ProjectSelector },

  props: {
    isMobile: { type: Boolean, default: false },
  },

  emits: ["toggle-sidebar"],

  setup() {
    const uiStore = useUiStore();
    const authStore = useAuthStore();
    const queryClient = useQueryClient();

    const { data: unreadData } = useQuery({
      queryKey: ["notifications", "unread-count"],
      queryFn: () => apiGet<{ count: number }>("/notifications/unread-count"),
      refetchInterval: 60_000,
    });

    return { uiStore, authStore, unreadData, queryClient };
  },

  data: () => ({
    notificationsOpen: false,
    notificationItems: [] as NotificationItem[],
    isLoadingNotifications: false,
  }),

  watch: {
    notificationsOpen(val: boolean): void {
      if (val) void this.fetchNotifications();
    },
  },

  computed: {
    unreadCount(): number {
      return this.unreadData?.count ?? 0;
    },
    userEmail(): string {
      return this.authStore.user?.email ?? "";
    },
    initials(): string {
      const name = this.authStore.user?.name ?? this.userEmail;
      const parts = name.split(/[\s@.]+/).filter(Boolean);
      if (parts.length >= 2) {
        return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
      }
      return (parts[0]?.slice(0, 2) ?? "?").toUpperCase();
    },
  },

  methods: {
    toggleNotifications(): void {
      this.notificationsOpen = !this.notificationsOpen;
    },

    async fetchNotifications(): Promise<void> {
      this.isLoadingNotifications = true;
      try {
        const data = await apiGet<{ notifications: NotificationItem[] }>("/notifications?limit=10");
        this.notificationItems = data.notifications;
      } finally {
        this.isLoadingNotifications = false;
      }
    },

    async markAllRead(): Promise<void> {
      await apiPost("/notifications/mark-all-read", {});
      this.notificationItems = this.notificationItems.map((n) => ({
        ...n,
        readAt: n.readAt ?? new Date().toISOString(),
      }));
      void this.queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
    },

    relativeTime(isoStr: string): string {
      const diff = Date.now() - new Date(isoStr).getTime();
      const mins = Math.floor(diff / 60_000);
      if (mins < 1) return this.$t("notifications.relative.justNow") as string;
      if (mins < 60) return this.$t("notifications.relative.minutesAgo", { n: mins }) as string;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return this.$t("notifications.relative.hoursAgo", { n: hours }) as string;
      return this.$t("notifications.relative.daysAgo", { n: Math.floor(hours / 24) }) as string;
    },
  },
});
</script>

<style scoped>
.app-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--topbar-height);
  padding: 0 var(--space-5);
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-glass-light);
  -webkit-backdrop-filter: var(--blur-glass-light);
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  gap: var(--space-4);
}

/* Left cluster */
.topbar-left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

.topbar-divider {
  width: 1px;
  height: 18px;
  background: var(--border-subtle);
  flex-shrink: 0;
}

/* Logo */
.topbar-logo {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.logo-text {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-tertiary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Right cluster */
.topbar-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

/* Icon button base */
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
              color var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
  position: relative;
  flex-shrink: 0;
}

@media (hover: hover) and (pointer: fine) {
  .icon-btn:hover {
    background: var(--bg-glass-strong);
    color: var(--text-primary);
  }
}

.icon-btn:active {
  transform: scale(0.97);
  transition-duration: 160ms;
}

/* Mobile: expand touch targets to ≥ 44px */
@media (max-width: 767px) {
  .icon-btn {
    width: 44px;
    height: 44px;
  }
}

/* Command palette button */
.cmd-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
              border-color var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
  white-space: nowrap;
}

@media (hover: hover) and (pointer: fine) {
  .cmd-btn:hover {
    background: var(--bg-glass-strong);
    border-color: var(--border-soft);
    color: var(--text-primary);
  }
}

.cmd-btn:active {
  transform: scale(0.97);
  transition-duration: 160ms;
}

.cmd-label {
  /* Hide on narrow screens, keep on desktop */
  display: none;
}

@media (min-width: 1024px) {
  .cmd-label { display: block; }
}

.cmd-kbd {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-soft);
  border-radius: 4px;
  font-size: 10px;
  color: var(--text-dim);
  line-height: 1.6;
}

/* Notification bell */
.notif-btn {
  color: var(--text-secondary);
}

.notif-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  background: var(--status-failed);
  border-radius: 7px;
  font-size: 8px;
  font-weight: 700;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

/* Notification wrapper + dropdown */
.notif-wrapper {
  position: relative;
}

.notif-backdrop {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-sticky) + 1);
}

.notif-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 320px;
  max-height: 420px;
  overflow-y: auto;
  background: var(--bg-elevated, #1a1a2e);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg, 10px);
  box-shadow: var(--shadow-elevated);
  z-index: calc(var(--z-sticky) + 2);
  display: flex;
  flex-direction: column;
}

.notif-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.notif-title {
  font-weight: 600;
  color: var(--text-primary);
}

.notif-mark-read {
  background: none;
  border: none;
  color: var(--accent-primary);
  cursor: pointer;
  font-family: var(--font-sans);
  padding: 0;
  font-size: 11px;
}

.notif-loading {
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.notif-skeleton {
  height: 48px;
  border-radius: var(--radius-sm);
  background: var(--bg-glass-strong);
  animation: shimmer 1.4s ease-in-out infinite;
}

@keyframes shimmer {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.notif-empty {
  padding: var(--space-6) var(--space-4);
  text-align: center;
  color: var(--text-dim);
}

.notif-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.notif-item {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  transition: background 120ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.notif-item:last-child {
  border-bottom: none;
}

.notif-item--unread {
  background: color-mix(in oklch, var(--accent-primary) 5%, transparent);
}

@media (hover: hover) and (pointer: fine) {
  .notif-item:hover {
    background: var(--bg-glass-strong);
  }
}

.notif-item-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 5px;
}

.dot--info { background: var(--accent-primary); }
.dot--warning { background: var(--status-warning, #f59e0b); }
.dot--critical { background: var(--status-failed); }

.notif-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.notif-item-title {
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notif-item-msg {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notif-item-time {
  margin-top: 2px;
}

/* Mobile: full-width dropdown */
@media (max-width: 767px) {
  .notif-dropdown {
    position: fixed;
    top: var(--topbar-height);
    right: 0;
    left: 0;
    width: 100%;
    max-height: 60vh;
    border-radius: 0 0 var(--radius-lg, 10px) var(--radius-lg, 10px);
  }
}

/* User avatar */
.avatar-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-tertiary) 100%);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
              transform var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
}

@media (hover: hover) and (pointer: fine) {
  .avatar-btn:hover { opacity: 0.85; }
}

.avatar-btn:active { transform: scale(0.97); transition-duration: 160ms; }

.avatar-initials {
  font-size: 11px;
  font-weight: 700;
  color: white;
  letter-spacing: 0;
  line-height: 1;
}
</style>
