<template>
  <div class="score-chart">
    <div
      v-for="row in rows"
      :key="row.key"
      class="chart-row"
    >
      <span class="row-label">{{ $t(`trends.detail.${row.labelKey}`) as string }}</span>
      <div class="row-bar-wrap">
        <div
          class="row-bar"
          :class="[`bar-${row.key}`, { 'bar-penalty': row.isPenalty }]"
          :style="{ width: `${row.percent}%` }"
        />
      </div>
      <span class="row-value mono">{{ row.value }}</span>
    </div>

    <div class="chart-total">
      <span class="total-label">{{ $t("trends.detail.totalScore") as string }}</span>
      <span class="total-value mono">{{ totalScore }}</span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { TrendScoreBreakdown } from "src/composables/useTrendsList";

interface ChartRow {
  key: string;
  labelKey: string;
  value: number;
  percent: number;
  isPenalty: boolean;
}

// Max possible value per component (for bar width scaling)
const MAX_BUZZ = 15;
const MAX_GROWTH = 15;
const MAX_OFFICIAL = 25;
const MAX_SERP = 20;
const MAX_DIVERSITY = 25;
const MAX_PENALTY = 40;

export default defineComponent({
  name: "ScoreBreakdownChart",

  props: {
    breakdown: {
      type: Object as PropType<TrendScoreBreakdown | null>,
      default: null,
    },
  },

  computed: {
    rows(): ChartRow[] {
      const b = this.breakdown;
      if (!b) return [];
      const allRows: ChartRow[] = [
        { key: "communityBuzz", labelKey: "communityBuzz", value: b.communityBuzz, percent: Math.round((b.communityBuzz / MAX_BUZZ) * 100), isPenalty: false },
        { key: "searchVolumeGrowth", labelKey: "searchVolumeGrowth", value: b.searchVolumeGrowth, percent: Math.round((b.searchVolumeGrowth / MAX_GROWTH) * 100), isPenalty: false },
        { key: "officialAnnouncement", labelKey: "officialAnnouncement", value: b.officialAnnouncement, percent: Math.round((b.officialAnnouncement / MAX_OFFICIAL) * 100), isPenalty: false },
        { key: "serpVolatility", labelKey: "serpVolatility", value: b.serpVolatility, percent: Math.round((b.serpVolatility / MAX_SERP) * 100), isPenalty: false },
        { key: "existingCoveragePenalty", labelKey: "coveragePenalty", value: b.existingCoveragePenalty, percent: Math.round((b.existingCoveragePenalty / MAX_PENALTY) * 100), isPenalty: true },
      ];
      if (b.sourceDiversity != null) {
        allRows.splice(4, 0, { key: "sourceDiversity", labelKey: "sourceDiversity", value: b.sourceDiversity, percent: Math.round((b.sourceDiversity / MAX_DIVERSITY) * 100), isPenalty: false });
      }
      return allRows;
    },

    totalScore(): number {
      const b = this.breakdown;
      if (!b) return 0;
      const pos = (b.communityBuzz ?? 0) + (b.searchVolumeGrowth ?? 0) + (b.officialAnnouncement ?? 0) + (b.serpVolatility ?? 0) + (b.sourceDiversity ?? 0);
      return Math.max(0, pos - (b.existingCoveragePenalty ?? 0));
    },
  },
});
</script>

<style scoped>
.score-chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chart-row {
  display: grid;
  grid-template-columns: 140px 1fr 32px;
  align-items: center;
  gap: 8px;
}

.row-label {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-bar-wrap {
  background: var(--bg-glass);
  border-radius: 3px;
  height: 8px;
  overflow: hidden;
}

.row-bar {
  height: 100%;
  border-radius: 3px;
  background: var(--accent-primary);
  transition: width 400ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.row-bar.bar-penalty {
  background: #ef4444;
}

.row-value {
  font-size: 11px;
  color: var(--text-tertiary);
  text-align: right;
}

.chart-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
  margin-top: 4px;
}

.total-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.total-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--accent-primary);
}
</style>
