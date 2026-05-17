<template>
  <textarea
    :id="id || undefined"
    v-bind="$attrs"
    :class="['form-textarea', { 'textarea-error': hasError }]"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :rows="rows"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    @blur="$emit('blur', $event)"
  />
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "FormTextarea",

  inheritAttrs: false,

  emits: ["update:modelValue", "blur"],

  props: {
    id: { type: String, default: "" },
    modelValue: { type: String, default: "" },
    placeholder: { type: String, default: "" },
    disabled: { type: Boolean, default: false },
    readonly: { type: Boolean, default: false },
    hasError: { type: Boolean, default: false },
    rows: { type: Number, default: 4 },
  },
});
</script>

<style scoped>
.form-textarea {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  transition: border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              box-shadow 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.form-textarea::placeholder {
  color: var(--text-tertiary);
}

.form-textarea:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px rgba(124, 92, 255, 0.15);
}

.form-textarea:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  resize: none;
}

.form-textarea.textarea-error {
  border-color: var(--status-failed);
  box-shadow: 0 0 0 2px rgba(255, 77, 109, 0.15);
}
</style>
