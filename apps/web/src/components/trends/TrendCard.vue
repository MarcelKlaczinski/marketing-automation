<template>
  <div
    class="trend-card"
    :class="{ 'trend-card--selected': selected }"
    role="button"
    tabindex="0"
    @click="$emit('select')"
    @keydown.enter="$emit('select')"
    @keydown.space.prevent="$emit('select')"
  >
    <div class="card-top">
      <div class="score-wrap" :class="scoreColorClass">
        <span class="score-value mono">{{ trendScore }}</span>
        <span class="score-label">{{ $t("trends.score") as string }}</span>
      </div>
      <div class="card-badges">
        <FreshnessBadge :freshness="trend.trendMetadata?.freshnessWindow ?? null" />
        <span v-if="trend.locale" class="locale-tag mono">{{ trend.locale }}</span>
      </div>
    </div>

    <h3 class="card-title">{{ trend.topicTitle }}</h3>
    <p v-if="trend.primaryKeyword" class="card-keyword mono">{{ trend.primaryKeyword }}</p>

    <div class="card-signals">
      <SignalChip
        v-for="signal in topSignals"
        :key="signal.id"
        :signal="signal"
      />
      <span v-if="moreSignalsCount > 0" class="signals-overflow mono">
        +{{ moreSignalsCount }}
      </span>
    </div>

    <div class="card-footer mono">
      <span class="card-age">{{ relativeTime(trend.createdAt) }}</span>
      <span
        v-if="trend.clusterAction === 'create_new'"
        class="cluster-tag cluster-tag--new"
      >
        {{ $t("trends.clusterAction.create_new") as string }}
      </span>
      <span
        v-else-if="trend.clusterAction === 'append_to_existing'"
        class="cluster-tag cluster-tag--append"
      >
        {{ $t("trends.clusterAction.append_to_existing") as string }}
      </span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { TrendBrief, TrendSignal } from "src/composables/useTrendsList";
import FreshnessBadge from "./FreshnessBadge.vue";
import SignalChip from "./SignalChip.vue";

export default defineComponent({
  name: "TrendCard",

  components: { FreshnessBadge, SignalChip },

  emits: ["select"],

  props: {
    trend: { type: Object as PropType<TrendBrief>, required: true },
    selected: { type: Boolean, default: false },
  },

  computed: {
    trendScore(): number {
      return this.trend.trendMetadata?.trendScore ?? 0;
    },
    scoreColorClass(): string {
      if (this.trendScore >= 70) return "score-high";
      if (this.trendScore >= 40) return "score-medium";
      return "score-low";
    },
    topSignals(): TrendSignal[] {
      return (this.trend.trendMetadata?.signals ?? []).slice(0, 3);
    },
    moreSignalsCount(): number {
      const total = this.trend.trendMetadata?.signals?.length ?? 0;
      return Math.max(0, total - 3);
    },
  },

  methods: {
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
.trend-card {
  padding: 12px 14px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              transform 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  outline: none;
}

@media (hover: hover) and (pointer: fine) {
  .trend-card:hover {
    background: var(--bg-glass-hover, rgba(255, 255, 255, 0.05));
    border-color: var(--border-medium, rgba(255, 255, 255, 0.12));
  }
}

.trend-card:active {
  transform: scale(0.99);
}

.trend-card--selected {
  background: color-mix(in oklch, var(--accent-primary) 8%, transparent);
  border-color: var(--accent-primary);
}

/* Top row */
.card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.score-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 40px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
}

.score-value {
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
}

.score-label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.score-high .score-value { color: #10b981; }
.score-medium .score-value { color: #f59e0b; }
.score-low .score-value { color: var(--text-secondary); }

.card-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.locale-tag {
  font-size: 10px;
  color: var(--text-tertiary);
  padding: 2px 5px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
}

/* Title & keyword */
.card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 3px;
  line-height: 1.35;
}

.card-keyword {
  font-size: 11px;
  color: var(--text-tertiary);
  margin: 0 0 8px;
}

/* Signals */
.card-signals {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}

.signals-overflow {
  font-size: 10px;
  color: var(--text-tertiary);
  align-self: center;
}

/* Footer */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card-age {
  font-size: 11px;
  color: var(--text-tertiary);
}

.cluster-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.cluster-tag--new {
  background: color-mix(in oklch, var(--accent-primary) 12%, transparent);
  color: var(--accent-primary);
}

.cluster-tag--append {
  background: color-mix(in oklch, #10b981 12%, transparent);
  color: #10b981;
}
</style>
