<template>
  <span :class="`status-pill status-pill--${status}`">
    <q-spinner v-if="status === 'running'" size="12px" class="q-mr-xs" />
    <q-icon v-else-if="status === 'complete'" name="check_circle" size="14px" class="q-mr-xs" />
    <q-icon v-else-if="status === 'awaiting_review'" name="pending" size="14px" class="q-mr-xs" />
    {{ $t(`coldStart.statusLabels.${status}`) }}
  </span>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { PhaseStatusLabel } from 'src/stores/cold-start';

export default defineComponent({
  name: 'PhaseStatusPill',
  props: {
    status: { type: String as PropType<PhaseStatusLabel>, required: true },
  },
});
</script>

<style lang="scss" scoped>
.status-pill {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

.status-pill--complete {
  background: rgba(33, 186, 69, 0.14);
  color: #21ba45;
}

.status-pill--running {
  background: rgba(63, 81, 181, 0.14);
  color: #3f51b5;
}

.status-pill--awaiting_review {
  background: rgba(242, 192, 55, 0.18);
  color: #b07b00;
}

.status-pill--pending {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.5);

  body.body--dark & {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.55);
  }
}
</style>
