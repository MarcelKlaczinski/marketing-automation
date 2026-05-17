<template>
  <div class="stat-card glass-elevated">
    <div class="stat-header">
      <span class="stat-label label-caps">{{ label }}</span>
      <span v-if="trend" class="stat-trend" :class="trendClass">
        {{ trend }}
      </span>
    </div>

    <div class="stat-value-row">
      <span v-if="loading" class="stat-loading">
        <LoadingShimmer variant="line" height="32px" width="80px" />
      </span>
      <template v-else>
        <span v-if="subtitle" class="stat-subtitle">{{ subtitle }}</span>
        <span class="stat-value mono">{{ displayValue }}</span>
      </template>
    </div>

    <div class="stat-sparkline">
      <SparklineChart
        :data="sparklineData"
        :color="sparklineColor"
        :width="120"
        :height="32"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import SparklineChart from "./SparklineChart.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";

/**
 * Glass stat card with large value, trend indicator and sparkline.
 * Used in DashboardStats for the 4 KPI metrics.
 */
export default defineComponent({
  name: "StatCard",

  components: { SparklineChart, LoadingShimmer },

  props: {
    /** Metric label (uppercase caption) */
    label: { type: String, required: true },
    /** Formatted display value, e.g. "12" or "€4.20" or "94%" */
    value: { type: [String, Number], default: null as null },
    /** Trend text with direction prefix, e.g. "+12% vs prev" */
    trend: { type: String, default: "" },
    /** Whether to show positive (green) or negative (red) trend styling */
    trendPositive: { type: Boolean, default: true },
    /** Raw data points for sparkline */
    sparklineData: {
      type: Array as () => number[],
      default: () => [] as number[],
    },
    /** Sparkline line + fill color */
    sparklineColor: { type: String, default: "#7c5cff" },
    /** Shows shimmer skeleton instead of value */
    loading: { type: Boolean, default: false },
    /** Optional small subtitle rendered below the value */
    subtitle: { type: String, default: "" },
  },

  computed: {
    displayValue(): string {
      if (this.value === null || this.value === undefined) return "—";
      return String(this.value);
    },
    trendClass(): string {
      return this.trendPositive ? "trend-up" : "trend-down";
    },
  },
});
</script>

<style scoped>
.stat-card {
  position: relative;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow: hidden;
  min-height: 110px;
}

/* glass-elevated comes from global — redefine locally for scoped isolation */
.stat-card {
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-glass);
  -webkit-backdrop-filter: var(--blur-glass);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-elevated);
}

.stat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.stat-label {
  color: var(--text-dim);
  letter-spacing: 0.06em;
}

.stat-trend {
  font-size: 10px;
  font-weight: 600;
}

.trend-up {
  color: var(--status-success);
}

.trend-down {
  color: var(--status-failed);
}

.stat-value-row {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-start;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, var(--text-primary) 0%, var(--text-secondary) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.stat-subtitle {
  font-size: 10px;
  color: var(--text-dim);
  font-weight: 500;
  letter-spacing: 0.02em;
  margin-bottom: 4px;
}

/* Sparkline pinned to bottom-right */
.stat-sparkline {
  position: absolute;
  bottom: 0;
  right: 0;
  opacity: 0.6;
  pointer-events: none;
}
</style>
