<template>
  <div class="week-navigator">
    <button
      type="button"
      class="nav-btn"
      :aria-label="$t('planner.prevWeek') as string"
      @click="$emit('prev')"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9,2 4,7 9,12" />
      </svg>
    </button>

    <button
      type="button"
      class="week-label"
      :aria-label="$t('planner.pickWeek') as string"
      @click="$emit('open-picker')"
    >
      <span class="week-line">{{ weekLabel }}</span>
      <span class="range-line text-tertiary">{{ rangeLabel }}</span>
    </button>

    <button
      type="button"
      class="nav-btn"
      :aria-label="$t('planner.nextWeek') as string"
      @click="$emit('next')"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="5,2 10,7 5,12" />
      </svg>
    </button>

    <button
      type="button"
      class="today-btn"
      @click="$emit('today')"
    >
      {{ $t("planner.thisWeek") as string }}
    </button>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { formatShortDate, isoWeekEndDate, isoWeekStartDate, toIsoDate } from "src/lib/iso-week";

/**
 * Week navigator: prev/next arrows + KW label + range + "today" button.
 * Emits `prev` / `next` / `today` / `open-picker` events — parent owns state.
 */
export default defineComponent({
  name: "PlannerWeekNavigator",

  emits: ["prev", "next", "today", "open-picker"],

  props: {
    year: { type: Number, required: true },
    isoWeek: { type: Number, required: true },
  },

  computed: {
    weekLabel(): string {
      return this.$t("planner.week", { n: this.isoWeek, year: this.year }) as string;
    },
    rangeLabel(): string {
      const start = toIsoDate(isoWeekStartDate(this.year, this.isoWeek));
      const end = toIsoDate(isoWeekEndDate(this.year, this.isoWeek));
      const locale: "de" | "en" = this.$i18n.locale === "de" ? "de" : "en";
      return this.$t("planner.weekRange", {
        start: formatShortDate(start, locale),
        end: formatShortDate(end, locale),
      }) as string;
    },
  },
});
</script>

<style scoped>
.week-navigator {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
              color var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
}

@media (hover: hover) and (pointer: fine) {
  .nav-btn:hover {
    background: var(--bg-glass-strong);
    color: var(--text-primary);
  }
}

.nav-btn:active {
  transform: scale(0.97);
  transition-duration: 160ms;
}

@media (max-width: 767px) {
  .nav-btn {
    min-width: 44px;
    min-height: 44px;
  }
}

.week-label {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  cursor: pointer;
  min-width: 200px;
  transition: background var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
}

.week-line {
  font-weight: 600;
  font-size: 14px;
  line-height: 1.2;
}

.range-line {
  font-size: 11px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.today-btn {
  padding: 6px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
              color var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
}

@media (hover: hover) and (pointer: fine) {
  .today-btn:hover {
    background: var(--bg-glass-strong);
    color: var(--text-primary);
  }
}

@media (max-width: 767px) {
  .today-btn {
    min-height: 44px;
  }
}
</style>
