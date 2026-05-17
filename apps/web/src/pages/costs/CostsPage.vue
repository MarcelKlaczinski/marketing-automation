<template>
  <div class="costs-page">
    <header class="costs-header">
      <h1 class="page-title">{{ $t("cost.title") as string }}</h1>
      <div class="window-selector">
        <button
          v-for="w in windows"
          :key="w"
          class="window-btn"
          :class="{ active: currentWindow === w }"
          @click="currentWindow = w"
        >
          {{ $t(`cost.windows.${w}`) as string }}
        </button>
      </div>
    </header>

    <!-- Stat cards -->
    <section class="costs-stats">
      <CostStatCard
        :label="$t('cost.stats.total') as string"
        :value="totalEur"
        unit="€"
      />
      <CostStatCard
        :label="$t('cost.stats.articles') as string"
        :value="articleCount"
        :unit="$t('cost.stats.articlesUnit') as string"
      />
      <CostStatCard
        :label="$t('cost.stats.avgPerArticle') as string"
        :value="avgPerArticle"
        unit="€"
      />
      <CostStatCard
        :label="$t('cost.stats.alerts') as string"
        :value="activeAlertCount"
      />
    </section>

    <!-- Breakdown charts -->
    <div class="costs-breakdown">
      <GlassCard variant="strong">
        <h2 class="card-title">{{ $t("cost.byService.title") as string }}</h2>
        <CostBreakdownChart
          :data="costData ? costData.byService : null"
          :total="totalEur"
        />
      </GlassCard>

      <GlassCard variant="strong">
        <h2 class="card-title">{{ $t("cost.byOperation.title") as string }}</h2>
        <CostBreakdownChart
          :data="costData ? costData.byOperation : null"
          :total="totalEur"
        />
      </GlassCard>
    </div>

    <!-- Trend chart -->
    <GlassCard variant="strong" class="costs-trend">
      <h2 class="card-title">{{ $t("cost.trend.title") as string }}</h2>
      <CostTrendChart :data="costData ? costData.trend : null" />
    </GlassCard>

    <!-- Alerts -->
    <section class="costs-alerts">
      <div class="section-header">
        <h2 class="section-title">{{ $t("cost.alerts.sectionTitle") as string }}</h2>
        <label class="show-acked-label">
          <input v-model="showAcked" type="checkbox" />
          {{ $t("cost.alerts.showAcked") as string }}
        </label>
      </div>

      <EmptyState
        v-if="!alerts.length"
        :title="$t('cost.alerts.empty.title') as string"
        :description="$t('cost.alerts.empty.description') as string"
      />

      <div v-else class="alert-list">
        <CostAlertCard
          v-for="alert in alerts"
          :key="alert.id"
          :alert="alert"
          @acknowledge="onAcknowledge"
        />
      </div>
    </section>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useRoute } from "vue-router";
import GlassCard from "src/components/ui/GlassCard.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import CostStatCard from "src/components/costs/CostStatCard.vue";
import CostBreakdownChart from "src/components/costs/CostBreakdownChart.vue";
import CostTrendChart from "src/components/costs/CostTrendChart.vue";
import CostAlertCard from "src/components/costs/CostAlertCard.vue";
import { apiGet, apiPost } from "src/lib/api";

type CostWindow = "today" | "week" | "month" | "year";

interface TrendPoint {
  date: string;
  costEur: number;
}

interface CostSummary {
  totalEur: number;
  articleCount: number;
  byService: Record<string, number>;
  byOperation: Record<string, number>;
  trend: TrendPoint[];
}

interface CostAlert {
  id: string;
  service: string;
  thresholdType: "daily" | "monthly";
  limitEur: string;
  spentEur: string;
  percent: number;
  acknowledgedAt: string | null;
  createdAt: string;
}

export default defineComponent({
  name: "CostsPage",

  components: {
    GlassCard,
    EmptyState,
    CostStatCard,
    CostBreakdownChart,
    CostTrendChart,
    CostAlertCard,
  },

  setup() {
    const route = useRoute();
    return { slug: route.params.slug as string };
  },

  data: () => ({
    currentWindow: "month" as CostWindow,
    showAcked: false,
    windows: ["today", "week", "month", "year"] as CostWindow[],
    costData: null as CostSummary | null,
    alerts: [] as CostAlert[],
  }),

  computed: {
    totalEur(): number {
      return this.costData?.totalEur ?? 0;
    },

    articleCount(): number {
      return this.costData?.articleCount ?? 0;
    },

    avgPerArticle(): number {
      if (!this.articleCount) return 0;
      return parseFloat((this.totalEur / this.articleCount).toFixed(2));
    },

    activeAlertCount(): number {
      return this.alerts.filter((a) => !a.acknowledgedAt).length;
    },
  },

  watch: {
    currentWindow(): void {
      void this.fetchCostData();
    },
    showAcked(): void {
      void this.fetchAlerts();
    },
  },

  mounted() {
    void this.fetchCostData();
    void this.fetchAlerts();
  },

  methods: {
    async fetchCostData(): Promise<void> {
      this.costData = await apiGet<CostSummary>(
        `/projects/${this.slug}/cost-summary?window=${this.currentWindow}`,
      );
    },

    async fetchAlerts(): Promise<void> {
      const params = new URLSearchParams();
      if (this.showAcked) params.set("includeAcked", "true");
      this.alerts = await apiGet<CostAlert[]>(`/cost/alerts?${params.toString()}`);
    },

    async onAcknowledge(alertId: string): Promise<void> {
      await apiPost(`/cost/alerts/${alertId}/acknowledge`);
      await this.fetchAlerts();
    },
  },
});
</script>

<style scoped>
.costs-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px 32px;
  overflow-y: auto;
  height: 100%;
}

.costs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.window-selector {
  display: flex;
  gap: 4px;
  background: var(--surface-secondary, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: 3px;
}

.window-btn {
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-radius: calc(var(--radius-md) - 2px);
  cursor: pointer;
  transition:
    background 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.window-btn.active {
  background: var(--surface-primary, rgba(255, 255, 255, 0.1));
  color: var(--text-primary);
}

.costs-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.costs-breakdown {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 16px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.show-acked-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.alert-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (max-width: 767px) {
  .costs-page {
    padding: 16px;
  }

  .costs-stats {
    grid-template-columns: repeat(2, 1fr);
  }

  .costs-breakdown {
    grid-template-columns: 1fr;
  }
}
</style>
