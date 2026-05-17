<template>
  <div class="form-select-wrap">
    <select
      :id="id || undefined"
      v-bind="$attrs"
      :class="['form-select', { 'select-error': hasError }]"
      :value="modelValue"
      :disabled="disabled"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <slot />
    </select>
    <span class="select-arrow" aria-hidden="true">▾</span>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "FormSelect",

  inheritAttrs: false,

  emits: ["update:modelValue"],

  props: {
    id: { type: String, default: "" },
    modelValue: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
    hasError: { type: Boolean, default: false },
  },
});
</script>

<style scoped>
.form-select-wrap {
  position: relative;
  width: 100%;
}

.form-select {
  width: 100%;
  padding: 8px 32px 8px 12px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.4;
  appearance: none;
  -webkit-appearance: none;
  outline: none;
  cursor: pointer;
  transition: border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              box-shadow 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.form-select:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px rgba(124, 92, 255, 0.15);
}

.form-select:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.form-select.select-error {
  border-color: var(--status-failed);
  box-shadow: 0 0 0 2px rgba(255, 77, 109, 0.15);
}

.select-arrow {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  color: var(--text-tertiary);
  pointer-events: none;
}
</style>
