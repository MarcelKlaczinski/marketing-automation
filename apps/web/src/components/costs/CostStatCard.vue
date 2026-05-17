<template>
  <GlassCard variant="strong" class="cost-stat-card">
    <span class="stat-label">{{ label }}</span>
    <div class="stat-value-row">
      <span class="stat-value mono">
        <template v-if="unit === '€'">€{{ formatValue }}</template>
        <template v-else>{{ formatValue }}<span v-if="unit" class="stat-unit"> {{ unit }}</span></template>
      </span>
    </div>
  </GlassCard>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import GlassCard from "src/components/ui/GlassCard.vue";

export default defineComponent({
  name: "CostStatCard",

  components: { GlassCard },

  props: {
    label: { type: String, required: true },
    value: { type: Number, default: 0 },
    unit: { type: String, default: "" },
  },

  computed: {
    formatValue(): string {
      if (this.unit === "€") {
        return this.value.toFixed(2);
      }
      return String(this.value);
    },
  },
});
</script>

<style scoped>
.cost-stat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 16px;
}

.stat-label {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
}

.stat-value-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
}

.stat-unit {
  font-size: 13px;
  font-weight: 400;
  color: var(--text-secondary);
}
</style>
