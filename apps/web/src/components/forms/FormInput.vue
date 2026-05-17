<template>
  <input
    :id="id || undefined"
    v-bind="$attrs"
    :class="['form-input', { 'input-error': hasError }]"
    :value="modelValue"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :aria-autocomplete="enableAutocomplete ? 'inline' : 'none'"
    :autocomplete="autocomplete"
    :inputmode="inputmode"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    @blur="$emit('blur', $event)"
  />
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

export default defineComponent({
  name: "FormInput",

  inheritAttrs: false,

  emits: ["update:modelValue", "blur"],

  props: {
    id: { type: String, default: "" },
    modelValue: { type: String, default: "" },
    type: { type: String, default: "text" },
    placeholder: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
    readonly: { type: Boolean, default: false },
    hasError: { type: Boolean, default: false },
    autocomplete: { type: String, default: "off" },
    inputmode: {
      type: String as PropType<"text" | "tel" | "email" | "url" | "numeric" | "decimal" | "search">,
      default: "text",
    },
    /** Enable browser autocomplete — only for external signup forms */
    enableAutocomplete: { type: Boolean, default: false },
  },
});
</script>

<style scoped>
.form-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.4;
  outline: none;
  transition: border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              box-shadow 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.form-input::placeholder {
  color: var(--text-tertiary);
}

.form-input:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px rgba(124, 92, 255, 0.15);
}

.form-input:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.form-input.input-error {
  border-color: var(--status-failed);
  box-shadow: 0 0 0 2px rgba(255, 77, 109, 0.15);
}
</style>
