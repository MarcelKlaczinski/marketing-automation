<template>
  <div class="chart-card">
    <div class="chart-card__title">{{ $t('cost.charts.daily') }}</div>
    <div v-if="!aggregations || !chartData.datasets[0] || chartData.datasets[0].data.length === 0" class="chart-card__empty">
      {{ $t('cost.charts.noData') }}
    </div>
    <div v-else class="chart-wrap">
      <Bar :data="chartData" :options="chartOptions" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { Chart, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import type { ChartOptions } from 'chart.js';
import { Bar } from 'vue-chartjs';
import { formatEur } from 'src/lib/format-eur';
import type { CostAggregations } from 'src/stores/cost';

Chart.register(BarElement, CategoryScale, LinearScale, Tooltip);

export default defineComponent({
  name: 'CostDailyChart',

  components: { Bar },

  props: {
    aggregations: { type: Object as PropType<CostAggregations | null>, default: null },
  },

  computed: {
    chartData() {
      const daily = this.aggregations?.thisMonth.daily ?? [];
      return {
        labels: daily.map((d) => d.day.slice(8)), // DD only
        datasets: [{
          label: 'EUR',
          backgroundColor: '#3f51b5',
          data: daily.map((d) => parseFloat(d.totalEur ?? '0')),
        }],
      };
    },

    chartOptions(): ChartOptions<'bar'> {
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `€ ${formatEur(ctx.parsed.y ?? 0)}`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              // Chart.js types tick value as number|string but a LinearScale only emits numbers
              callback: (v) => v == null ? '' : `€ ${formatEur(v as number)}`,
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
