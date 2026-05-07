<template>
  <div class="summary-grid">
    <div class="summary-card">
      <div class="summary-card__label">{{ $t('cost.summary.thisMonth') }}</div>
      <div v-if="loading" class="summary-card__value">
        <q-skeleton type="text" width="80px" />
      </div>
      <div v-else class="summary-card__value">€ {{ formatEur(aggregations?.thisMonth.totalEur ?? '0') }}</div>
      <div v-if="trendCaption" class="summary-card__caption">
        <q-icon :name="trendIcon" :color="trendColor" size="14px" class="q-mr-xs" />
        {{ trendCaption }}
      </div>
    </div>

    <div class="summary-card">
      <div class="summary-card__label">{{ $t('cost.summary.lastMonth') }}</div>
      <div v-if="loading" class="summary-card__value">
        <q-skeleton type="text" width="80px" />
      </div>
      <div v-else class="summary-card__value">€ {{ formatEur(aggregations?.lastMonth.totalEur ?? '0') }}</div>
    </div>

    <div class="summary-card">
      <div class="summary-card__label">{{ $t('cost.summary.thisYear') }}</div>
      <div v-if="loading" class="summary-card__value">
        <q-skeleton type="text" width="80px" />
      </div>
      <div v-else class="summary-card__value">€ {{ formatEur(aggregations?.thisYear.totalEur ?? '0') }}</div>
    </div>

    <div class="summary-card">
      <div class="summary-card__label">{{ $t('cost.summary.dailyAvg') }}</div>
      <div v-if="loading" class="summary-card__value">
        <q-skeleton type="text" width="80px" />
      </div>
      <div v-else class="summary-card__value">€ {{ formatEur(dailyAvg) }}</div>
      <div class="summary-card__caption">{{ $t('cost.summary.dailyAvgHint') }}</div>
    </div>
  </div>
</template>

<script lang="ts">
import { formatEur } from "src/lib/format-eur";
import type { CostAggregations } from "src/stores/cost";
import { type PropType, defineComponent } from "vue";

export default defineComponent({
  name: "CostSummaryCards",

  props: {
    aggregations: { type: Object as PropType<CostAggregations | null>, default: null },
    loading: { type: Boolean, default: false },
  },

  computed: {
    thisMonthValue(): number {
      return Number.parseFloat(this.aggregations?.thisMonth.totalEur ?? "0");
    },
    lastMonthValue(): number | null {
      const v = this.aggregations?.lastMonth.totalEur;
      return v !== undefined ? Number.parseFloat(v) : null;
    },
    trendIcon(): string {
      if (this.lastMonthValue === null) return "remove";
      return this.thisMonthValue > this.lastMonthValue ? "trending_up" : "trending_down";
    },
    trendColor(): string {
      if (this.lastMonthValue === null) return "grey";
      return this.thisMonthValue > this.lastMonthValue ? "negative" : "positive";
    },
    trendCaption(): string {
      if (this.lastMonthValue === null || !this.aggregations) return "";
      const diff = this.thisMonthValue - this.lastMonthValue;
      const pct = this.lastMonthValue > 0 ? Math.abs(diff / this.lastMonthValue) * 100 : 0;
      const sign = diff >= 0 ? "+" : "−";
      return `${sign}${pct.toFixed(0)}% ${this.$t("cost.summary.vsLastMonth") as string}`;
    },
    dailyAvg(): string {
      if (!this.aggregations) return "0";
      const totalThisMonth = Number.parseFloat(this.aggregations.thisMonth.totalEur);
      const dayOfMonth = new Date().getDate();
      return (totalThisMonth / dayOfMonth).toFixed(6);
    },
  },

  methods: {
    formatEur,
  },
});
</script>

<style lang="scss" scoped>
.summary-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;

  @media (min-width: 640px) {
    grid-template-columns: repeat(2, 1fr);
  }
  @media (min-width: 1024px) {
    grid-template-columns: repeat(4, 1fr);
  }
}

.summary-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 16px 20px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.summary-card__label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-bottom: 8px;
}

.summary-card__value {
  font-size: 26px;
  font-weight: 600;
  margin-bottom: 4px;
  font-variant-numeric: tabular-nums;
}

.summary-card__caption {
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  display: flex;
  align-items: center;
}
</style>
