<template>
  <div class="trends-page">
    <!-- List pane -->
    <aside class="list-pane">
      <header class="pane-header">
        <div class="header-top">
          <h1 class="page-title">{{ $t("trends.title") as string }}</h1>
          <div class="action-row">
            <GlassButton
              variant="secondary"
              size="sm"
              :loading="collecting"
              @click="onTriggerCollect"
            >
              {{ $t("trends.synthesis.collect") as string }}
              <q-tooltip max-width="260px" anchor="bottom middle" self="top middle">
                {{ $t("trends.synthesis.collectTooltip") as string }}
              </q-tooltip>
            </GlassButton>
            <GlassButton
              variant="primary"
              size="sm"
              :loading="synthesizing"
              @click="onTriggerSynthesis"
            >
              {{ $t("trends.synthesis.runNow") as string }}
              <q-tooltip max-width="260px" anchor="bottom middle" self="top middle">
                {{ $t("trends.synthesis.runNowTooltip") as string }}
              </q-tooltip>
            </GlassButton>
          </div>
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

        <!-- Refresh result panel -->
        <div v-if="lastRefreshResult" class="refresh-panel">
          <div class="refresh-panel-header">
            <span class="refresh-panel-title mono">
              {{ $t("trends.refresh.panelTitle") as string }}
            </span>
            <button
              type="button"
              class="refresh-panel-dismiss"
              :aria-label="$t('trends.refresh.dismissPanel') as string"
              @click="dismissRefreshPanel"
            >
              ×
            </button>
          </div>
          <p class="refresh-panel-summary">
            <template v-if="lastRefreshResult.totalRowsAdded > 0">
              {{
                $t(
                  "trends.refresh.summaryNew",
                  { n: lastRefreshResult.totalRowsAdded },
                  lastRefreshResult.totalRowsAdded,
                ) as string
              }}
            </template>
            <template v-else>
              {{ $t("trends.refresh.summaryNone") as string }}
            </template>
          </p>
          <ul class="refresh-panel-list">
            <li
              v-for="row in lastRefreshResult.sourceResults"
              :key="row.source"
              class="refresh-panel-row"
            >
              <span class="refresh-source-name">
                {{ $t(`trends.sources.${row.source}`) as string }}
              </span>
              <span class="refresh-source-status" :class="statusClass(row.status)">
                {{ statusLabel(row) }}
              </span>
            </li>
          </ul>
          <div v-if="allEnabledFresh" class="refresh-panel-force">
            <p class="refresh-panel-notice">
              {{ $t("trends.refresh.allFreshNotice") as string }}
            </p>
            <GlassButton
              variant="secondary"
              size="sm"
              :loading="collecting"
              @click="onForceCollect"
            >
              {{ $t("trends.refresh.forceButton") as string }}
              <q-tooltip max-width="260px" anchor="bottom middle" self="top middle">
                {{ $t("trends.refresh.forceButtonTooltip") as string }}
              </q-tooltip>
            </GlassButton>
          </div>
        </div>
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
import {
  useTrendsList,
  type SignalRefreshSourceResult,
  type SignalRefreshStatus,
} from "src/composables/useTrendsList";
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

  computed: {
    /**
     * True iff the last refresh reported every result as `fresh` AND there
     * was at least one such row. In that case the staleness gate blocked
     * every enabled source, and the user can opt-in to force a re-fetch.
     */
    allEnabledFresh(): boolean {
      const result = this.lastRefreshResult;
      if (!result) return false;
      const freshRows = result.sourceResults.filter((r) => r.status === "fresh");
      if (freshRows.length === 0) return false;
      const blockingStatuses: SignalRefreshStatus[] = [
        "refreshed",
        "no_credentials",
        "error",
        "filter_no_results",
      ];
      return !result.sourceResults.some((r) => blockingStatuses.includes(r.status));
    },
  },

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

    async onTriggerCollect(): Promise<void> {
      await this.triggerCollect();
      // After a fresh collect, immediately re-fetch the briefs list — the
      // pool may now show new unprocessed signals visible in the side-panel.
      this.invalidate();
    },

    async onForceCollect(): Promise<void> {
      await this.triggerCollect({ force: true });
      this.invalidate();
    },

    dismissRefreshPanel(): void {
      this.lastRefreshResult = null;
    },

    statusLabel(row: SignalRefreshSourceResult): string {
      if (row.status === "refreshed") {
        return this.$t("trends.refresh.sourceStatus.refreshed", { n: row.rowsAdded }) as string;
      }
      return this.$t(`trends.refresh.sourceStatus.${row.status}`) as string;
    },

    statusClass(status: SignalRefreshStatus): string {
      return `status-${status}`;
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
  flex-wrap: wrap;
}

.action-row {
  display: flex;
  align-items: center;
  gap: 6px;
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

/* Refresh result panel */
.refresh-panel {
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-glass);
}

.refresh-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.refresh-panel-title {
  font-size: 10px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.refresh-panel-dismiss {
  background: transparent;
  border: 0;
  color: var(--text-tertiary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 4px;
  transition: color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .refresh-panel-dismiss:hover {
    color: var(--text-primary);
  }
}

.refresh-panel-summary {
  font-size: 12px;
  color: var(--text-primary);
  font-weight: 600;
  margin: 0 0 6px;
}

.refresh-panel-list {
  list-style: none;
  margin: 0 0 6px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.refresh-panel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
}

.refresh-source-name {
  color: var(--text-secondary);
}

.refresh-source-status {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-glass-strong);
  color: var(--text-tertiary);
}

.refresh-source-status.status-refreshed {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.refresh-source-status.status-fresh {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
}

.refresh-source-status.status-error,
.refresh-source-status.status-no_credentials {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.refresh-panel-force {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.refresh-panel-notice {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.4;
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
