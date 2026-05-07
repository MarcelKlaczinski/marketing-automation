<template>
  <q-item
    clickable
    :class="['notification-item', { 'notification-item--unread': !notification.readAt }]"
    @click="$emit('click', notification)"
  >
    <q-item-section avatar>
      <q-icon :name="iconName" :color="iconColor" size="20px" />
    </q-item-section>
    <q-item-section>
      <q-item-label>{{ notification.title }}</q-item-label>
      <q-item-label caption lines="2">{{ notification.message }}</q-item-label>
      <q-item-label caption class="notification-item__time">
        {{ relativeTime }}
      </q-item-label>
    </q-item-section>
    <q-item-section v-if="!notification.readAt" side>
      <div class="unread-dot" />
    </q-item-section>
  </q-item>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { NotificationRow } from 'src/stores/notifications';

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
  name: 'NotificationItem',

  props: {
    notification: { type: Object as PropType<NotificationRow>, required: true },
  },

  emits: ['click'],

  computed: {
    iconName(): string {
      return SEVERITY_ICONS[this.notification.severity] ?? 'notifications';
    },
    iconColor(): string {
      return SEVERITY_COLORS[this.notification.severity] ?? 'grey';
    },
    relativeTime(): string {
      const ms = Date.now() - new Date(this.notification.createdAt).getTime();
      const s = Math.round(ms / 1000);
      if (s < 60) return this.$t('notifications.relative.justNow') as string;
      const m = Math.round(s / 60);
      if (m < 60) return this.$t('notifications.relative.minutesAgo', { n: m }) as string;
      const h = Math.round(m / 60);
      if (h < 24) return this.$t('notifications.relative.hoursAgo', { n: h }) as string;
      const d = Math.round(h / 24);
      return this.$t('notifications.relative.daysAgo', { n: d }) as string;
    },
  },
});
</script>

<style lang="scss" scoped>
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
