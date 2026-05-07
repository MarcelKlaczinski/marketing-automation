<template>
  <q-page padding>
    <div class="row items-center q-mb-lg">
      <div class="col">
        <h1 class="text-h5 q-my-none">{{ $t('activity.title') }}</h1>
        <p class="text-caption text-grey-7 q-mt-xs">
          {{ $t('activity.subtitle', { count: activeCount }) }}
        </p>
      </div>
      <div class="col-auto">
        <q-btn flat round icon="refresh" :loading="loading" @click="refresh" />
      </div>
    </div>

    <div class="filters q-mb-md">
      <q-select
        v-model="selectedProjectId"
        outlined
        dense
        emit-value
        map-options
        :options="projectOptions"
        :label="$t('activity.filters.project')"
        style="min-width: 220px;"
      />
      <q-select
        v-model="selectedType"
        outlined
        dense
        emit-value
        map-options
        :options="typeOptions"
        :label="$t('activity.filters.type')"
        clearable
        style="min-width: 200px;"
      />
      <q-select
        v-model="selectedStatus"
        outlined
        dense
        emit-value
        map-options
        :options="statusOptions"
        :label="$t('activity.filters.status')"
        clearable
        style="min-width: 160px;"
      />
      <q-select
        v-model="selectedSinceHours"
        outlined
        dense
        emit-value
        map-options
        :options="sinceOptions"
        :label="$t('activity.filters.since')"
        style="min-width: 160px;"
      />
    </div>

    <div v-if="loading && filteredEntries.length === 0" class="text-center q-pa-xl">
      <q-spinner size="3em" color="primary" />
    </div>

    <div v-else-if="filteredEntries.length === 0" class="empty-state">
      <q-icon name="event_note" size="64px" color="grey-5" />
      <p class="text-body1 q-mt-md">{{ $t('activity.empty') }}</p>
      <p class="text-caption text-grey-7">{{ $t('activity.emptyHint') }}</p>
    </div>

    <div v-else class="activity-list">
      <ActivityRow
        v-for="entry in filteredEntries"
        :key="entry.id"
        :entry="entry"
      />
    </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import { useProjectsStore } from 'src/stores/projects';
import { useActiveRunsPolling, type ActivityEntry, type ActivityType, type NormalizedStatus } from 'src/composables/useActiveRunsPolling';
import ActivityRow from 'src/components/activity/ActivityRow.vue';

export default defineComponent({
  name: 'ActivityPage',

  components: { ActivityRow },

  setup() {
    const projectId = ref<string | null>(null);
    const sinceHours = ref<number>(24);

    const polling = useActiveRunsPolling({ projectId, sinceHours });

    return {
      projectId,
      sinceHours,
      pollingEntries: polling.entries,
      activeCount: polling.activeCount,
      loading: polling.loading,
      refresh: polling.refresh,
    };
  },

  data: () => ({
    selectedType: null as ActivityType | null,
    selectedStatus: null as NormalizedStatus | null,
  }),

  computed: {
    projectsStore: () => useProjectsStore(),

    selectedProjectId: {
      get(): string | null {
        return this.projectId;
      },
      set(value: string | null): void {
        this.projectId = value;
      },
    },

    selectedSinceHours: {
      get(): number {
        return this.sinceHours;
      },
      set(value: number): void {
        this.sinceHours = value;
      },
    },

    projectOptions(): { label: string; value: string | null }[] {
      return [
        { label: this.$t('activity.filters.allProjects') as string, value: null },
        ...this.projectsStore.list.map((p) => ({ label: p.name, value: p.id })),
      ];
    },

    typeOptions(): { label: string; value: ActivityType }[] {
      const types: ActivityType[] = ['cold_start', 'article_outline', 'article_draft', 'astro_sync', 'pagespeed', 'schema_extension', 'link_rebuild'];
      return types.map((t) => ({ label: this.$t(`activity.types.${t}`) as string, value: t }));
    },

    statusOptions(): { label: string; value: NormalizedStatus }[] {
      const statuses: NormalizedStatus[] = ['queued', 'running', 'completed', 'failed', 'cancelled'];
      return statuses.map((s) => ({ label: this.$t(`activity.statuses.${s}`) as string, value: s }));
    },

    sinceOptions(): { label: string; value: number }[] {
      return [
        { label: this.$t('activity.since.24h') as string, value: 24 },
        { label: this.$t('activity.since.7d') as string, value: 24 * 7 },
        { label: this.$t('activity.since.30d') as string, value: 24 * 30 },
      ];
    },

    filteredEntries(): ActivityEntry[] {
      let result = this.pollingEntries;
      if (this.selectedType) {
        result = result.filter((e) => e.type === this.selectedType);
      }
      if (this.selectedStatus) {
        result = result.filter((e) => e.status === this.selectedStatus);
      }
      return result;
    },
  },

  async created() {
    if (this.projectsStore.list.length === 0) {
      await this.projectsStore.fetchList();
    }
  },
});
</script>

<style lang="scss" scoped>
.filters {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.activity-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-state {
  text-align: center;
  padding: 80px 0;

  p {
    margin: 0;
  }
}
</style>
