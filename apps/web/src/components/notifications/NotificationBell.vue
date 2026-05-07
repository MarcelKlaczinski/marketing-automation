<template>
  <q-btn flat round dense :icon="bellIcon" :aria-label="$t('notifications.title') as string">
    <q-badge v-if="unreadCount > 0" color="negative" floating>
      {{ displayCount }}
    </q-badge>

    <q-menu anchor="bottom right" self="top right" max-height="600px">
      <div class="bell-menu">
        <div class="bell-menu__header">
          <span class="text-subtitle1">{{ $t('notifications.title') }}</span>
          <q-space />
          <q-btn
            v-if="unreadCount > 0"
            flat
            dense
            size="sm"
            :label="$t('notifications.markAllRead') as string"
            @click="onMarkAllRead"
          />
        </div>

        <q-separator />

        <div v-if="loading && list.length === 0" class="text-center q-pa-md">
          <q-spinner size="2em" />
        </div>

        <div v-else-if="list.length === 0" class="text-center q-pa-xl text-grey-7">
          <q-icon name="notifications_off" size="48px" color="grey-5" />
          <div class="q-mt-md">{{ $t('notifications.empty') }}</div>
        </div>

        <q-list v-else separator>
          <q-item
            v-for="n in list"
            :key="n.id"
            clickable
            :class="['notification-item', { 'notification-item--unread': !n.readAt }]"
            @click="onClickItem(n)"
          >
            <q-item-section avatar>
              <q-icon :name="iconFor(n)" :color="colorFor(n)" size="20px" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ n.title }}</q-item-label>
              <q-item-label caption lines="2">{{ n.message }}</q-item-label>
              <q-item-label caption class="notification-item__time">
                {{ relativeTime(n.createdAt) }}
              </q-item-label>
            </q-item-section>
            <q-item-section v-if="!n.readAt" side>
              <div class="unread-dot" />
            </q-item-section>
          </q-item>
        </q-list>

        <q-separator />

        <div class="bell-menu__footer">
          <q-btn
            flat
            size="sm"
            :label="$t('notifications.viewSettings') as string"
            :to="{ name: 'settings', query: { tab: 'notifications' } }"
          />
          <q-space />
          <span v-if="!sseConnected" class="text-caption text-warning">
            <q-icon name="sync_problem" size="14px" />
            {{ $t('notifications.disconnected') }}
          </span>
        </div>
      </div>
    </q-menu>
  </q-btn>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useNotificationsStore, type NotificationRow } from 'src/stores/notifications';
import { useNotificationStream } from 'src/composables/useNotificationStream';

const SEVERITY_ICONS: Record<string, string> = {
  info: 'info',
  warning: 'warning',
  critical: 'error',
};

const SEVERITY_COLORS: Record<string, string> = {
  info: 'primary',
  warning: 'warning',
  critical: 'negative',
};

export default defineComponent({
  name: 'NotificationBell',

  setup() {
    const stream = useNotificationStream();
    return {
      store: useNotificationsStore(),
      sseConnected: stream.connected,
    };
  },

  computed: {
    list(): NotificationRow[] {
      return this.store.list;
    },
    unreadCount(): number {
      return this.store.unreadCount;
    },
    loading(): boolean {
      return this.store.loading;
    },
    bellIcon(): string {
      return this.unreadCount > 0 ? 'notifications_active' : 'notifications';
    },
    displayCount(): string {
      return this.unreadCount > 99 ? '99+' : String(this.unreadCount);
    },
  },

  methods: {
    iconFor(n: NotificationRow): string {
      return SEVERITY_ICONS[n.severity] ?? 'notifications';
    },
    colorFor(n: NotificationRow): string {
      return SEVERITY_COLORS[n.severity] ?? 'grey';
    },
    relativeTime(iso: string): string {
      const ms = Date.now() - new Date(iso).getTime();
      const s = Math.round(ms / 1000);
      if (s < 60) return this.$t('notifications.relative.justNow') as string;
      const m = Math.round(s / 60);
      if (m < 60) return this.$t('notifications.relative.minutesAgo', { n: m }) as string;
      const h = Math.round(m / 60);
      if (h < 24) return this.$t('notifications.relative.hoursAgo', { n: h }) as string;
      const d = Math.round(h / 24);
      return this.$t('notifications.relative.daysAgo', { n: d }) as string;
    },
    async onClickItem(n: NotificationRow): Promise<void> {
      if (!n.readAt) {
        await this.store.markAsRead([n.id]);
      }
      if (n.link) {
        void this.$router.push(n.link);
      }
    },
    async onMarkAllRead(): Promise<void> {
      await this.store.markAllAsRead();
    },
  },
});
</script>

<style lang="scss" scoped>
.bell-menu {
  width: 380px;
  display: flex;
  flex-direction: column;
}

.bell-menu__header,
.bell-menu__footer {
  display: flex;
  align-items: center;
  padding: 10px 16px;
}

.notification-item {
  &--unread {
    background: rgba(63, 81, 181, 0.04);

    body.body--dark & {
      background: rgba(63, 81, 181, 0.12);
    }
  }
}

.notification-item__time {
  margin-top: 2px;
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.45));
}

.unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--q-primary);
}
</style>
