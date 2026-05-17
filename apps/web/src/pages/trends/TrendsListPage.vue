<template>
  <div class="trends-page">
    <!-- List pane -->
    <aside class="list-pane">
      <header class="pane-header">
        <div class="header-top">
          <h1 class="page-title">{{ $t("trends.title") as string }}</h1>
          <GlassButton
            variant="primary"
            size="sm"
            :loading="synthesizing"
            @click="onTriggerSynthesis"
          >
            {{ $t("trends.synthesis.runNow") as string }}
          </GlassButton>
        </div>

        <!-- Cron status chip -->
        <div v-if="cronStatus" class="cron-status-row">
          <span
            class="cron-status-dot"
            :class="cronStatus.trendsSynthesizer.isActive ? 'dot-active' : 'dot-inactive'"
          />
          <span class="cron-status-label mono">
            {{
              cronStatus.trendsSynthesizer.isActive
                ? $t("settings.discovery.active") as string
                : $t("settings.discovery.inactive") as string
            }}
            <template v-if="cronStatus.trendsSynthesizer.lastRunAt">
              &middot;
              {{ $t("settings.discovery.lastRun") as string }}
              {{ relativeTime(cronStatus.trendsSynthesizer.lastRunAt) }}
            </template>
          </span>
        </div>

        <!-- Count badge -->
        <p class="list-subtitle mono">
          {{ trends.length }}
          {{ $t("trends.briefs") as string }}
        </p>
      </header>

      <!-- List content -->
      <div class="list-scroll">
        <LoadingShimmer
          v-if="isLoading"
          variant="card"
          :count="5"
        />
        <EmptyState
          v-else-if="!trends.length"
          :title="$t('trends.emptyTitle') as string"
          :description="$t('trends.emptyDescription') as string"
        />
        <template v-else>
          <TrendCard
            v-for="trend in trends"
            :key="trend.id"
            :trend="trend"
            :selected="trend.id === selectedId"
            @select="onSelectTrend(trend.id)"
          />
        </template>
      </div>
    </aside>

    <!-- Detail pane -->
    <main class="detail-pane">
      <router-view v-if="selectedId" />
      <EmptyState
        v-else
        :title="$t('trends.detail.emptyTitle') as string"
        :description="$t('trends.detail.emptyDescription') as string"
      />
    </main>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useTrendsList } from "src/composables/useTrendsList";
import TrendCard from "src/components/trends/TrendCard.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";

export default defineComponent({
  name: "TrendsListPage",

  components: { TrendCard, GlassButton, EmptyState, LoadingShimmer },

  setup() {
    return useTrendsList();
  },

  data: () => ({
    selectedId: null as string | null,
  }),

  watch: {
    "$route.params.trendId": {
      immediate: true,
      handler(id: string | undefined): void {
        this.selectedId = id ?? null;
      },
    },
  },

  methods: {
    onSelectTrend(id: string): void {
      this.selectedId = id;
      void this.$router.push({
        name: "trend-detail",
        params: { slug: this.$route.params.slug, trendId: id },
      });
    },

    async onTriggerSynthesis(): Promise<void> {
      await this.triggerSynthesis();
    },

    relativeTime(iso: string): string {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60_000);
      if (mins < 2) return this.$t("forms.justNow") as string;
      if (mins < 60) return this.$t("forms.minutesAgo", { n: mins }, mins) as string;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return this.$t("forms.hoursAgo", { n: hrs }, hrs) as string;
      const days = Math.floor(hrs / 24);
      return this.$t("forms.daysAgo", { n: days }, days) as string;
    },
  },
});
</script>

<style scoped>
.trends-page {
  display: grid;
  grid-template-columns: 320px 1fr;
  height: 100%;
  overflow: hidden;
}

/* List pane */
.list-pane {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
  overflow: hidden;
}

.pane-header {
  padding: 16px 16px 10px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.header-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.page-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.cron-status-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.cron-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-active {
  background: #10b981;
  box-shadow: 0 0 5px rgba(16, 185, 129, 0.5);
}

.dot-inactive {
  background: var(--text-tertiary);
}

.cron-status-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

.list-subtitle {
  font-size: 11px;
  color: var(--text-tertiary);
  margin: 0;
}

.list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Detail pane */
.detail-pane {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* Mobile: stack vertically */
@media (max-width: 767px) {
  .trends-page {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .list-pane {
    border-right: none;
    border-bottom: 1px solid var(--border-subtle);
    max-height: 45vh;
  }

  .detail-pane {
    max-height: 55vh;
  }
}
</style>
