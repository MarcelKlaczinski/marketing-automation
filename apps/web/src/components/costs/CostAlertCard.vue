<template>
  <GlassCard :variant="alert.acknowledgedAt ? 'default' : 'strong'" class="alert-card">
    <div class="alert-body">
      <div class="alert-meta-row">
        <span class="alert-service mono">{{ alert.service }}</span>
        <span class="alert-type mono">{{ $t(`cost.thresholdTypes.${alert.thresholdType}`) as string }}</span>
        <span class="alert-time mono">{{ relativeTime }}</span>
      </div>

      <div class="alert-numbers">
        <span class="alert-spent mono">€{{ parseFloat(alert.spentEur).toFixed(2) }}</span>
        <span class="alert-sep">/</span>
        <span class="alert-limit mono">€{{ parseFloat(alert.limitEur).toFixed(2) }}</span>
        <span class="alert-percent mono">({{ alert.percent }}%)</span>
      </div>
    </div>

    <div v-if="!alert.acknowledgedAt" class="alert-actions">
      <GlassButton variant="secondary" size="sm" @click="$emit('acknowledge', alert.id)">
        {{ $t("cost.alerts.acknowledge") as string }}
      </GlassButton>
    </div>
    <div v-else class="alert-acked mono">
      {{ $t("cost.alerts.ackedAt", { time: ackedRelativeTime }) as string }}
    </div>
  </GlassCard>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";
import GlassCard from "src/components/ui/GlassCard.vue";
import GlassButton from "src/components/ui/GlassButton.vue";

interface CostAlert {
  id: string;
  service: string;
  thresholdType: "daily" | "monthly";
  limitEur: string;
  spentEur: string;
  percent: number;
  acknowledgedAt: string | null;
  createdAt: string;
}

export default defineComponent({
  name: "CostAlertCard",

  components: { GlassCard, GlassButton },

  props: {
    alert: { type: Object as PropType<CostAlert>, required: true },
  },

  emits: ["acknowledge"],

  computed: {
    relativeTime(): string {
      return this.formatRelative(this.alert.createdAt);
    },

    ackedRelativeTime(): string {
      if (!this.alert.acknowledgedAt) return "";
      return this.formatRelative(this.alert.acknowledgedAt);
    },
  },

  methods: {
    formatRelative(dateStr: string): string {
      const diffMs = Date.now() - new Date(dateStr).getTime();
      const mins = Math.floor(diffMs / 60_000);
      if (mins < 1) return this.$t("forms.justNow") as string;
      if (mins < 60) return this.$t("forms.minutesAgo", { n: mins }) as string;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return this.$t("forms.hoursAgo", { n: hrs }) as string;
      return this.$t("forms.daysAgo", { n: Math.floor(hrs / 24) }) as string;
    },
  },
});
</script>

<style scoped>
.alert-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 16px;
}

.alert-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.alert-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.alert-service {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.alert-type {
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--surface-secondary, rgba(255,255,255,0.06));
  border-radius: var(--radius-sm);
  padding: 2px 6px;
}

.alert-time {
  font-size: 11px;
  color: var(--text-tertiary);
}

.alert-numbers {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.alert-spent {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-warning, #f59e0b);
}

.alert-sep {
  font-size: 12px;
  color: var(--text-tertiary);
}

.alert-limit {
  font-size: 13px;
  color: var(--text-secondary);
}

.alert-percent {
  font-size: 11px;
  color: var(--text-tertiary);
}

.alert-actions {
  flex-shrink: 0;
}

.alert-acked {
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
</style>
