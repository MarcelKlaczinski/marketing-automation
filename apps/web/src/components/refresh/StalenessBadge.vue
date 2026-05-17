<template>
  <span class="staleness-badge" :class="severityClass">
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
      <circle cx="6" cy="6" r="5" />
      <polyline points="6,3 6,6 8,7.5" />
    </svg>
    <span>{{ daysDisplay }}</span>
  </span>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "StalenessBadge",

  props: {
    days: { type: Number, required: true },
  },

  computed: {
    severityClass(): string {
      if (this.days >= 365) return "staleness-severe";
      if (this.days >= 180) return "staleness-outdated";
      if (this.days >= 90) return "staleness-aging";
      return "staleness-fresh";
    },

    daysDisplay(): string {
      return this.$t("trends.days", { n: this.days }, this.days) as string;
    },
  },
});
</script>

<style scoped>
.staleness-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid transparent;
}

.staleness-severe {
  background: color-mix(in oklch, #ef4444 12%, transparent);
  border-color: color-mix(in oklch, #ef4444 35%, transparent);
  color: #ef4444;
}
.staleness-outdated {
  background: color-mix(in oklch, #f97316 12%, transparent);
  border-color: color-mix(in oklch, #f97316 35%, transparent);
  color: #f97316;
}
.staleness-aging {
  background: color-mix(in oklch, #eab308 12%, transparent);
  border-color: color-mix(in oklch, #eab308 35%, transparent);
  color: #eab308;
}
.staleness-fresh {
  background: var(--bg-glass);
  border-color: var(--border-subtle);
  color: var(--text-tertiary);
}
</style>
