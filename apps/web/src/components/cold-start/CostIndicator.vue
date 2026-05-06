<template>
  <div v-if="costEur" class="cost-indicator">
    <q-icon name="payments" size="14px" class="q-mr-xs" />
    {{ $t('coldStart.costSoFar') }}: € {{ formattedCost }}
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'CostIndicator',
  props: {
    costEur: { type: String, default: null },
  },
  computed: {
    formattedCost(): string {
      const num = parseFloat(this.costEur ?? '0');
      return isNaN(num) ? '0.00' : num.toFixed(2);
    },
  },
});
</script>

<style lang="scss" scoped>
.cost-indicator {
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-top: 8px;
  display: flex;
  align-items: center;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.55);
  }
}
</style>
