<template>
  <button
    :class="['action-row', { 'action-row--disabled': !action.enabled || loading }]"
    :disabled="!action.enabled || loading"
    type="button"
    @click="$emit('click')"
  >
    <q-tooltip v-if="!action.enabled">
      {{ $t('articles.actions.notAvailable') }}
    </q-tooltip>
    <q-icon :name="action.icon" size="18px" class="action-row__icon" />
    <span class="action-row__label">{{ $t(action.i18nKey) }}</span>
    <q-spinner v-if="loading" size="14px" color="primary" class="action-row__spinner" />
    <q-icon v-else-if="action.enabled" name="chevron_right" size="14px" class="action-row__chevron" />
  </button>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';

export interface ActionDef {
  id: string;
  i18nKey: string;
  icon: string;
  enabled: boolean;
}

export default defineComponent({
  name: 'PipelineActionRow',

  props: {
    action: { type: Object as PropType<ActionDef>, required: true },
    loading: { type: Boolean, default: false },
  },

  emits: ['click'],
});
</script>

<style lang="scss" scoped>
.action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 6px;
  background: var(--q-card-bg, #fff);
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  color: var(--q-dark, #1d1d1d);
  transition: border-color 0.15s, background 0.15s;
  text-align: left;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
    background: var(--q-card-bg, #2a2a2a);
    color: rgba(255, 255, 255, 0.87);
  }

  &:hover:not(:disabled) {
    border-color: var(--q-primary);
    background: rgba(63, 81, 181, 0.04);
  }

  &--disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.action-row__icon {
  color: var(--q-primary);
  flex-shrink: 0;

  .action-row--disabled & {
    color: var(--q-grey-6, #757575);
  }
}

.action-row__label {
  flex-grow: 1;
  font-weight: 500;
}

.action-row__chevron {
  color: var(--q-grey-5, #9e9e9e);
  flex-shrink: 0;
}

.action-row__spinner {
  flex-shrink: 0;
}
</style>
