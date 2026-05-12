<template>
  <div class="chart-card">
    <div class="chart-card__title">{{ $t('cost.charts.byService') }}</div>
    <div v-if="!aggregations || !chartData.datasets[0] || chartData.datasets[0].data.length === 0" class="chart-card__empty">
      {{ $t('cost.charts.noData') }}
    </div>
    <div v-else class="chart-wrap">
      <Doughnut :data="chartData" :options="chartOptions" />
    </div>
  </div>
</template>

<script lang="ts">
import { ArcElement, Chart, Legend, Tooltip } from "chart.js";
import type { ChartOptions } from "chart.js";
import { formatEur } from "src/lib/format-eur";
import type { CostAggregations } from "src/stores/cost";
import { type PropType, defineComponent } from "vue";
import { Doughnut } from "vue-chartjs";

Chart.register(ArcElement, Tooltip, Legend);

const SERVICE_COLORS: Record<string, string> = {
  anthropic: "#3f51b5",
  replicate: "#7c4dff",
  dataforseo: "#26a69a",
  smtp: "#f2c037",
};

export default defineComponent({
  name: "CostByServiceChart",

  components: { Doughnut },

  props: {
    aggregations: { type: Object as PropType<CostAggregations | null>, default: null },
  },

  computed: {
    chartData() {
      const services = this.aggregations?.thisMonth.byService ?? [];
      return {
        labels: services.map((s) => s.service),
        datasets: [
          {
            backgroundColor: services.map((s) => SERVICE_COLORS[s.service] ?? "#999999"),
            data: services.map((s) => Number.parseFloat(s.totalEur ?? "0")),
          },
        ],
      };
    },

    chartOptions(): ChartOptions<"doughnut"> {
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "right",
            labels: { boxWidth: 12, padding: 12 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const label = ctx.label ?? "";
                const value = ctx.parsed;
                return `${label}: € ${formatEur(value)}`;
              },
            },
          },
        },
      };
    },
  },
});
</script>

<style lang="scss" scoped>
.chart-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 20px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.chart-card__title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}

.chart-card__empty {
  text-align: center;
  padding: 40px 0;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
}

.chart-wrap {
  height: 240px;
  position: relative;
}
</style>
