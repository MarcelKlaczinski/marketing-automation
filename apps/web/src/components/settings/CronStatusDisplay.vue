<template>
  <div class="cron-status">
    <div class="status-row">
      <span :class="['status-dot', status.isActive ? 'dot-active' : 'dot-inactive']" />
      <span class="status-label">
        {{ status.isActive ? $t("settings.discovery.active") : $t("settings.discovery.inactive") }}
      </span>
      <span class="cron-pattern mono">{{ status.cronPattern }}</span>
    </div>

    <div v-if="status.lastRunAt" class="status-meta">
      <span class="meta-label">{{ $t("settings.discovery.lastRun") }}:</span>
      <span :class="['meta-value', `run-${status.lastRunStatus ?? 'unknown'}`]">
        {{ relativeTime(status.lastRunAt) }}
      </span>
    </div>

    <div v-if="status.nextRunAt && status.isActive" class="status-meta">
      <span class="meta-label">{{ $t("settings.discovery.nextRun") }}:</span>
      <span class="meta-value">{{ relativeTime(status.nextRunAt) }}</span>
    </div>

    <button
      class="run-now-btn"
      :disabled="triggering"
      @click="$emit('trigger')"
    >
      {{ triggering ? $t("settings.discovery.running") : $t("settings.discovery.runNow") }}
    </button>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { CronJobStatus } from "src/composables/useDiscoverySettings";

export default defineComponent({
  name: "CronStatusDisplay",

  props: {
    status: {
      type: Object as PropType<CronJobStatus>,
      required: true,
    },
    triggering: {
      type: Boolean,
      default: false,
    },
  },

  emits: ["trigger"],

  methods: {
    relativeTime(isoString: string): string {
      const ms = Date.now() - new Date(isoString).getTime();
      const mins = Math.floor(Math.abs(ms) / 60_000);
      // Future dates (nextRunAt)
      if (ms < 0) {
        if (mins < 60) return this.$t("settings.discovery.inMinutes", { n: mins }) as string;
        return this.$t("settings.discovery.inHours", { n: Math.floor(mins / 60) }) as string;
      }
      if (mins < 1) return this.$t("forms.justNow") as string;
      if (mins < 60) return this.$t("forms.minutesAgo", { n: mins }) as string;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return this.$t("forms.hoursAgo", { n: hours }) as string;
      return this.$t("forms.daysAgo", { n: Math.floor(hours / 24) }) as string;
    },
  },
});
</script>

<style scoped>
.cron-status {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-active {
  background: var(--color-success, #22c55e);
}

.dot-inactive {
  background: var(--text-tertiary, #6b7280);
}

.status-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.cron-pattern {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 2px 6px;
  background: var(--bg-glass);
  border-radius: var(--radius-sm);
}

.status-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.meta-label {
  color: var(--text-tertiary);
}

.meta-value {
  color: var(--text-secondary);
}

.run-success { color: var(--color-success, #22c55e); }
.run-failed  { color: var(--color-danger, #ef4444); }
.run-unknown { color: var(--text-tertiary); }

.run-now-btn {
  margin-top: 4px;
  padding: 5px 12px;
  font-size: 12px;
  font-family: inherit;
  color: var(--accent-primary);
  background: transparent;
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              opacity 0.15s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  width: fit-content;
}

@media (hover: hover) and (pointer: fine) {
  .run-now-btn:hover:not(:disabled) {
    background: color-mix(in oklch, var(--accent-primary) 12%, transparent);
  }
}

.run-now-btn:active:not(:disabled) {
  transform: scale(0.97);
  transition-duration: 160ms;
}

.run-now-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 767px) {
  .run-now-btn {
    min-height: 44px;
  }
}
</style>
