<template>
  <div class="cost-breakdown">
    <div v-if="!hasData" class="no-data mono">{{ $t("cost.charts.noData") as string }}</div>
    <div
      v-for="(value, key) in sortedData"
      v-else
      :key="key"
      class="breakdown-row"
    >
      <div class="breakdown-label">{{ key }}</div>
      <div class="breakdown-bar-wrap">
        <div
          class="breakdown-bar"
          :style="{ width: percent(value) + '%' }"
        />
      </div>
      <div class="breakdown-value mono">€{{ value.toFixed(2) }}</div>
      <div class="breakdown-percent mono">{{ percent(value).toFixed(0) }}%</div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";

export default defineComponent({
  name: "CostBreakdownChart",

  props: {
    data: {
      type: Object as PropType<Record<string, number> | null | undefined>,
      default: null,
    },
    total: { type: Number, default: 0 },
  },

  computed: {
    hasData(): boolean {
      return !!this.data && Object.keys(this.data).length > 0;
    },

    sortedData(): Record<string, number> {
      if (!this.data) return {};
      return Object.fromEntries(
        Object.entries(this.data).sort(([, a], [, b]) => b - a),
      );
    },
  },

  methods: {
    percent(value: number): number {
      if (!this.total || this.total === 0) return 0;
      return Math.min(100, (value / this.total) * 100);
    },
  },
});
</script>

<style scoped>
.cost-breakdown {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.no-data {
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 16px 0;
  text-align: center;
}

.breakdown-row {
  display: grid;
  grid-template-columns: 120px 1fr 70px 40px;
  align-items: center;
  gap: 8px;
}

.breakdown-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.breakdown-bar-wrap {
  height: 6px;
  background: var(--surface-secondary, rgba(255, 255, 255, 0.05));
  border-radius: 3px;
  overflow: hidden;
}

.breakdown-bar {
  height: 100%;
  background: var(--accent-primary, #7c5cff);
  border-radius: 3px;
  transition: width 300ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.breakdown-value {
  font-size: 12px;
  color: var(--text-primary);
  text-align: right;
}

.breakdown-percent {
  font-size: 11px;
  color: var(--text-tertiary);
  text-align: right;
}

@media (max-width: 767px) {
  .breakdown-row {
    grid-template-columns: 90px 1fr 60px 36px;
  }
}
</style>
