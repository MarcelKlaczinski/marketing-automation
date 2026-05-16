<template>
  <section class="dashboard-stats" :aria-label="$t('dashboard.stats.activeRuns')">
    <StatCard
      :label="$t('dashboard.stats.activeRuns') as string"
      :value="activeCount"
      :trend="activeCountTrend"
      :sparkline-data="runSparkline"
      sparkline-color="#00d4ff"
      :loading="isLoadingFeed"
    />
    <StatCard
      :label="$t('dashboard.stats.costMonth') as string"
      :value="costMonthDisplay"
      :trend="costTrend"
      :trend-positive="costTrendPositive"
      :sparkline-data="costSparkline"
      sparkline-color="#7c5cff"
      :loading="isLoadingCost"
    />
    <StatCard
      :label="$t('dashboard.stats.articlesWeek') as string"
      :value="articlesWeekDisplay"
      :sparkline-data="[]"
      sparkline-color="#4ade80"
      :loading="isLoadingArticles"
    />
    <StatCard
      :label="$t('dashboard.stats.successRate') as string"
      :value="successRateDisplay"
      :sparkline-data="[]"
      sparkline-color="#4ade80"
      :loading="isLoadingFeed"
    />
  </section>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useActivityFeed } from "src/composables/useActivityFeed";
import { useCostSummary } from "src/composables/useCostSummary";
import { useProjectStore } from "src/stores/project";
import { apiGet } from "src/lib/api";
import StatCard from "src/components/stats/StatCard.vue";

interface ArticlesWeekResponse { count: number }

/**
 * 4-column grid of KPI stat cards.
 * Each card independently fetches its data so failures are isolated.
 */
export default defineComponent({
  name: "DashboardStats",

  components: { StatCard },

  setup() {
    const projectStore = useProjectStore();
    const window = ref<"today" | "week" | "month">("month");

    const { data: feedData, isLoading: isLoadingFeed } = useActivityFeed();

    const { data: costData, isLoading: isLoadingCost } = useCostSummary(window);

    const { data: articlesData, isLoading: isLoadingArticles } = useQuery({
      queryKey: ["articles-week", projectStore.currentSlug],
      queryFn: () =>
        apiGet<ArticlesWeekResponse>(
          `/projects/${projectStore.currentSlug}/articles/count?window=week`,
        ),
      staleTime: 60_000,
    });

    const activeCount = computed<number>(() => {
      const runs = feedData.value ?? [];
      return runs.filter((r) => r.status === "running" || r.status === "queued").length;
    });

    const successRate = computed<number>(() => {
      const runs = feedData.value ?? [];
      const completed = runs.filter((r) => r.status === "completed").length;
      const failed = runs.filter((r) => r.status === "failed").length;
      const total = completed + failed;
      return total > 0 ? Math.round((completed / total) * 100) : 100;
    });

    return {
      feedData,
      costData,
      articlesData,
      isLoadingFeed,
      isLoadingCost,
      isLoadingArticles,
      activeCount,
      successRate,
    };
  },

  computed: {
    activeCountTrend(): string {
      return "";
    },

    runSparkline(): number[] {
      const runs = this.feedData ?? [];
      // Simple sparkline: count per run (normalized by status order)
      return runs.map((_, i) => i + 1);
    },

    costMonthDisplay(): string {
      const cost = this.costData?.totalEur;
      if (cost === undefined || cost === null) return "—";
      return `€${cost.toFixed(2)}`;
    },

    costTrend(): string {
      const data = this.costData;
      if (!data) return "";
      const prev = data.previousEur;
      if (!prev) return "";
      const pct = Math.round(data.trendPercent);
      return pct >= 0
        ? this.$t("dashboard.stats.trendUp", { n: pct }) as string
        : this.$t("dashboard.stats.trendDown", { n: Math.abs(pct) }) as string;
    },

    costTrendPositive(): boolean {
      // Lower cost = positive
      const data = this.costData;
      return !data || data.trendPercent <= 0;
    },

    costSparkline(): number[] {
      return this.costData?.sparkline ?? [];
    },

    articlesWeekDisplay(): string | number {
      return this.articlesData?.count ?? "—";
    },

    successRateDisplay(): string {
      return `${this.successRate}%`;
    },
  },
});
</script>

<style scoped>
.dashboard-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

@media (max-width: 1023px) {
  .dashboard-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 767px) {
  .dashboard-stats {
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
  }
}
</style>
