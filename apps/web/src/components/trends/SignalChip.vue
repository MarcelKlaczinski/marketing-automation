<template>
  <span class="signal-chip" :class="`signal-${normalizedSource}`">
    {{ $t(`trends.sources.${signal.source}`, signal.source) as string }}
  </span>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { TrendSignal } from "src/composables/useTrendsList";

export default defineComponent({
  name: "SignalChip",

  props: {
    signal: { type: Object as PropType<TrendSignal>, required: true },
  },

  computed: {
    normalizedSource(): string {
      return this.signal.source.replace(/_/g, "-");
    },
  },
});
</script>

<style scoped>
.signal-chip {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
  white-space: nowrap;
}

.signal-producthunt {
  background: color-mix(in oklch, #da552f 12%, transparent);
  border-color: color-mix(in oklch, #da552f 35%, transparent);
  color: #da552f;
}
.signal-hackernews {
  background: color-mix(in oklch, #ff6600 12%, transparent);
  border-color: color-mix(in oklch, #ff6600 35%, transparent);
  color: #c05000;
}
.signal-reddit {
  background: color-mix(in oklch, #ff4500 12%, transparent);
  border-color: color-mix(in oklch, #ff4500 35%, transparent);
  color: #ff4500;
}
.signal-github {
  background: color-mix(in oklch, #6e7681 12%, transparent);
  border-color: color-mix(in oklch, #6e7681 35%, transparent);
  color: var(--text-secondary);
}
.signal-vendor-rss {
  background: color-mix(in oklch, #3b82f6 12%, transparent);
  border-color: color-mix(in oklch, #3b82f6 35%, transparent);
  color: #3b82f6;
}
.signal-dataforseo-trends {
  background: color-mix(in oklch, #10b981 12%, transparent);
  border-color: color-mix(in oklch, #10b981 35%, transparent);
  color: #10b981;
}
</style>
