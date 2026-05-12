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
          <NotificationItem
            v-for="n in list"
            :key="n.id"
            :notification="n"
            @click="onClickItem"
          />
        </q-list>

        <div v-if="store.hasMore" class="bell-menu__load-more">
          <q-btn
            flat
            dense
            size="sm"
            no-caps
            :label="$t('notifications.loadMore') as string"
            :loading="store.loading"
            @click="onLoadMore"
          />
        </div>

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
import NotificationItem from './NotificationItem.vue';

export default defineComponent({
  name: 'NotificationBell',

  components: { NotificationItem },

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
    async onLoadMore(): Promise<void> {
      await this.store.loadMore();
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

.bell-menu__load-more {
  display: flex;
  justify-content: center;
  padding: 4px 16px;
}

</style>
