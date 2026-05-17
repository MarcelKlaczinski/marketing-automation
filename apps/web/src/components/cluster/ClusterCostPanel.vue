<template>
  <div class="cost-panel">
    <h3 class="panel-label">{{ $t("clusters.detail.cost") as string }}</h3>
    <div class="cost-main">
      <span class="cost-spent mono">€{{ spentFormatted }}</span>
      <span class="cost-sep">/</span>
      <span class="cost-estimated mono">€{{ estimatedFormatted }}</span>
    </div>
    <div class="cost-meta">
      <span class="cost-meta-item">
        <span class="cost-meta-label">{{ $t("clusters.detail.spent") as string }}</span>
        <span class="cost-meta-value mono">€{{ spentFormatted }}</span>
      </span>
      <span class="cost-meta-item">
        <span class="cost-meta-label">{{ $t("clusters.detail.estimated") as string }}</span>
        <span class="cost-meta-value mono">€{{ estimatedFormatted }}</span>
      </span>
    </div>
    <div v-if="percentUsed !== null" class="cost-bar-track">
      <div class="cost-bar-fill" :style="{ width: `${Math.min(percentUsed, 100)}%` }" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";

export default defineComponent({
  name: "ClusterCostPanel",

  props: {
    cost: {
      type: Object as PropType<{ spentEur: number; estimatedEur: number } | null>,
      default: null,
    },
  },

  computed: {
    spentFormatted(): string {
      return (this.cost?.spentEur ?? 0).toFixed(2);
    },
    estimatedFormatted(): string {
      const est = this.cost?.estimatedEur;
      return est != null ? est.toFixed(2) : "—";
    },
    percentUsed(): number | null {
      const spent = this.cost?.spentEur;
      const estimated = this.cost?.estimatedEur;
      if (spent == null || !estimated) return null;
      return Math.round((spent / estimated) * 100);
    },
  },
});
</script>

<style scoped>
.cost-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.panel-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0;
}

.cost-main {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.cost-spent {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
}

.cost-sep {
  font-size: 14px;
  color: var(--text-tertiary);
}

.cost-estimated {
  font-size: 14px;
  color: var(--text-tertiary);
}

.cost-meta {
  display: flex;
  gap: 16px;
}

.cost-meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cost-meta-label {
  font-size: 9px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.cost-meta-value {
  font-size: 11px;
  color: var(--text-secondary);
}

.cost-bar-track {
  height: 3px;
  background: var(--border-subtle);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 4px;
}

.cost-bar-fill {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 2px;
  transition: width 400ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
</style>
