<template>
  <div class="cost-trend-chart">
    <div v-if="!hasData" class="no-data mono">{{ $t("cost.charts.noData") as string }}</div>
    <svg
      v-else
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      class="trend-svg"
    >
      <defs>
        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent-primary, #7c5cff)" stop-opacity="0.4" />
          <stop offset="100%" stop-color="var(--accent-primary, #7c5cff)" stop-opacity="0" />
        </linearGradient>
      </defs>

      <!-- Area fill -->
      <path :d="areaPath" fill="url(#trendGrad)" />

      <!-- Line -->
      <path :d="linePath" fill="none" stroke="var(--accent-primary, #7c5cff)" stroke-width="2" />

      <!-- Dots with tooltip -->
      <circle
        v-for="(pt, i) in points"
        :key="i"
        :cx="pt.x"
        :cy="pt.y"
        r="3"
        fill="var(--accent-primary, #7c5cff)"
        class="trend-dot"
      >
        <title>{{ pt.date }}: €{{ pt.value.toFixed(2) }}</title>
      </circle>
    </svg>

    <!-- X-axis labels (first + last) -->
    <div v-if="hasData" class="x-axis">
      <span class="x-label mono">{{ points[0]?.date ?? "" }}</span>
      <span class="x-label mono">{{ points[points.length - 1]?.date ?? "" }}</span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";

interface TrendPoint {
  date: string;
  costEur: number;
}

interface ChartPoint {
  x: number;
  y: number;
  date: string;
  value: number;
}

const W = 600;
const H = 120;
const PAD_X = 8;
const PAD_Y = 10;

export default defineComponent({
  name: "CostTrendChart",

  props: {
    data: {
      type: Array as PropType<TrendPoint[] | null | undefined>,
      default: null,
    },
  },

  data: () => ({ W, H }),

  computed: {
    hasData(): boolean {
      return !!this.data && this.data.length > 1;
    },

    points(): ChartPoint[] {
      if (!this.data || this.data.length < 2) return [];
      const values = this.data.map((d) => d.costEur);
      const maxVal = Math.max(...values, 0.001);
      return this.data.map((d, i) => ({
        x: PAD_X + (i / (this.data!.length - 1)) * (W - 2 * PAD_X),
        y: PAD_Y + (1 - d.costEur / maxVal) * (H - 2 * PAD_Y),
        date: d.date,
        value: d.costEur,
      }));
    },

    linePath(): string {
      if (this.points.length < 2) return "";
      return this.points
        .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(" ");
    },

    areaPath(): string {
      if (this.points.length < 2) return "";
      const bottom = H - PAD_Y;
      const first = this.points[0];
      const last = this.points[this.points.length - 1];
      if (!first || !last) return "";
      return (
        this.linePath +
        ` L${last.x.toFixed(1)},${bottom} L${first.x.toFixed(1)},${bottom} Z`
      );
    },
  },
});
</script>

<style scoped>
.cost-trend-chart {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.no-data {
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 16px 0;
  text-align: center;
}

.trend-svg {
  width: 100%;
  height: 120px;
  display: block;
}

.trend-dot {
  cursor: default;
}

.x-axis {
  display: flex;
  justify-content: space-between;
}

.x-label {
  font-size: 10px;
  color: var(--text-tertiary);
}
</style>
