<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-lg">
      <div class="col">
        <h1 class="text-h5 q-my-none">{{ $t('inbox.title') }}</h1>
        <p class="text-caption text-grey-7 q-mt-xs">
          {{ $t('inbox.signedInAs', { email: userEmail }) }}
        </p>
      </div>
      <div class="col-auto">
        <q-btn
          flat
          round
          dense
          icon="refresh"
          :loading="loading"
          :aria-label="$t('inbox.refresh') as string"
          @click="refresh"
        />
      </div>
    </div>

    <!-- Setup-incomplete banner (existing) -->
    <q-banner v-if="!systemStatusStore.allConfigured" class="bg-warning text-dark q-mb-md">
      <template #avatar>
        <q-icon name="warning" />
      </template>
      <div>{{ $t('inbox.setupIncomplete') }}</div>
      <template #action>
        <q-btn flat :label="$t('inbox.openInstaller') as string" :to="{ name: 'installer' }" />
      </template>
    </q-banner>

    <!-- All-empty state -->
    <div v-if="!loading && allEmpty" class="all-empty-state">
      <q-icon name="check_circle" size="64px" color="positive" />
      <p class="text-h6 q-mt-md">{{ $t('inbox.allQuiet.title') }}</p>
      <p class="text-body2 text-grey-7">{{ $t('inbox.allQuiet.subtitle') }}</p>
    </div>

    <template v-else>
      <!-- Section 1: current tasks -->
      <InboxSection
        :title="$t('inbox.tasks.title') as string"
        :count="tasks.length"
        :loading="loading"
        :empty-message="$t('inbox.tasks.empty') as string"
        :is-empty="!loading && tasks.length === 0"
      >
        <div class="task-grid">
          <InboxTaskGroup
            v-for="group in groupedTasks"
            :key="group.status"
            :status="group.status"
            :articles="group.articles"
          />
        </div>
      </InboxSection>

      <!-- Section 2: active pipeline runs -->
      <InboxSection
        :title="$t('inbox.running.title') as string"
        :count="runningRuns.length"
        :loading="loading"
        :empty-message="$t('inbox.running.empty') as string"
        :is-empty="!loading && runningRuns.length === 0"
        class="q-mt-xl"
      >
        <q-list separator class="bordered-list">
          <InboxRunRow v-for="run in runningRuns" :key="run.id" :entry="run" />
        </q-list>
      </InboxSection>

      <!-- Section 3: recent unread notifications -->
      <InboxSection
        :title="$t('inbox.recentNotifications.title') as string"
        :count="recentNotifications.length"
        :loading="loading"
        :empty-message="$t('inbox.recentNotifications.empty') as string"
        :is-empty="!loading && recentNotifications.length === 0"
        class="q-mt-xl"
      >
        <q-list separator class="bordered-list">
          <NotificationItem
            v-for="n in recentNotifications"
            :key="n.id"
            :notification="n"
            @click="onNotificationClick"
          />
        </q-list>
      </InboxSection>
    </template>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useAuthStore } from 'src/stores/auth';
import { useSystemStatusStore } from 'src/stores/system-status';
import { useNotificationsStore, type NotificationRow } from 'src/stores/notifications';
import { api } from 'src/lib/api-client';
import InboxSection from 'src/components/inbox/InboxSection.vue';
import InboxTaskGroup from 'src/components/inbox/InboxTaskGroup.vue';
import InboxRunRow, { type InboxRunEntry } from 'src/components/inbox/InboxRunRow.vue';
import { type InboxArticle } from 'src/components/inbox/InboxTaskCard.vue';
import NotificationItem from 'src/components/notifications/NotificationItem.vue';

const TASK_STATUSES = ['outline_review', 'final_review', 'proposed'] as const;
type TaskStatus = typeof TASK_STATUSES[number];

export default defineComponent({
  name: 'InboxPage',

  components: {
    InboxSection,
    InboxTaskGroup,
    InboxRunRow,
    NotificationItem,
  },

  setup() {
    return {
      authStore: useAuthStore(),
      systemStatusStore: useSystemStatusStore(),
      notificationsStore: useNotificationsStore(),
    };
  },

  data: () => ({
    tasks: [] as InboxArticle[],
    activeRuns: [] as InboxRunEntry[],
    recentNotifications: [] as NotificationRow[],
    loading: false,
  }),

  computed: {
    userEmail(): string {
      return this.authStore.user?.email ?? '';
    },
    runningRuns(): InboxRunEntry[] {
      return this.activeRuns.filter((r) => r.status === 'queued' || r.status === 'running');
    },
    allEmpty(): boolean {
      return this.tasks.length === 0
        && this.runningRuns.length === 0
        && this.recentNotifications.length === 0;
    },
    groupedTasks(): Array<{ status: TaskStatus; articles: InboxArticle[] }> {
      const groups: Array<{ status: TaskStatus; articles: InboxArticle[] }> = [];
      for (const status of TASK_STATUSES) {
        const filtered = this.tasks.filter((a) => a.status === status);
        if (filtered.length > 0) groups.push({ status, articles: filtered });
      }
      return groups;
    },
  },

  async created() {
    await this.refresh();
  },

  methods: {
    async refresh(): Promise<void> {
      this.loading = true;
      try {
        await Promise.all([
          this.fetchTasks(),
          this.fetchActiveRuns(),
          this.fetchRecentNotifications(),
        ]);
      } finally {
        this.loading = false;
      }
    },

    async fetchTasks(): Promise<void> {
      const statuses = ['proposed', 'outline_review', 'final_review'].join(',');
      const res = await api.get<{ ok: boolean; data: InboxArticle[] }>(
        `/articles/across-projects?statuses=${statuses}`,
      );
      this.tasks = res.data.data;
    },

    async fetchActiveRuns(): Promise<void> {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const res = await api.get<{ ok: boolean; data: { entries: InboxRunEntry[] } }>(
        `/pipeline-runs/active?since=${encodeURIComponent(since)}`,
      );
      this.activeRuns = res.data.data.entries;
    },

    async fetchRecentNotifications(): Promise<void> {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const res = await api.get<{ ok: boolean; data: { notifications: NotificationRow[] } }>(
        `/notifications?since=${encodeURIComponent(since)}&unreadOnly=true&limit=10`,
      );
      this.recentNotifications = res.data.data.notifications;
    },

    async onNotificationClick(n: NotificationRow): Promise<void> {
      if (!n.readAt) {
        await this.notificationsStore.markAsRead([n.id]);
      }
      if (n.link) {
        void this.$router.push(n.link);
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.task-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}

.bordered-list {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.all-empty-state {
  text-align: center;
  padding: 100px 0;
}
</style>
