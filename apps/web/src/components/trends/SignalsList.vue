<template>
  <div class="signals-list">
    <p v-if="!signals.length" class="no-signals">
      {{ $t("trends.detail.noSignals") as string }}
    </p>
    <div
      v-for="signal in signals"
      :key="signal.id"
      class="signal-row"
    >
      <SignalChip :signal="signal" />
      <span class="signal-id mono">{{ signal.externalId }}</span>
      <span class="signal-age mono">{{ relativeTime(signal.capturedAt) }}</span>
      <a
        v-if="signal.url"
        :href="signal.url"
        target="_blank"
        rel="noopener noreferrer"
        class="signal-link"
        :aria-label="$t('trends.detail.openUrl') as string"
        @click.stop
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7" />
          <path d="M8 1h3v3" />
          <line x1="11" y1="1" x2="5" y2="7" />
        </svg>
      </a>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { TrendSignal } from "src/composables/useTrendsList";
import SignalChip from "./SignalChip.vue";

export default defineComponent({
  name: "SignalsList",

  components: { SignalChip },

  props: {
    signals: { type: Array as PropType<TrendSignal[]>, required: true },
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
.signals-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.no-signals {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0;
}

.signal-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.signal-id {
  flex: 1;
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.signal-age {
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.signal-link {
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  flex-shrink: 0;
  transition: color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .signal-link:hover {
    color: var(--accent-primary);
  }
}
</style>
