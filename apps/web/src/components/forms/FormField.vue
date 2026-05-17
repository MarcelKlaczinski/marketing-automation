<template>
  <div class="form-field" :class="{ 'has-error': !!error }">
    <label v-if="label" :for="fieldId" class="form-field-label">
      {{ label }}
      <span v-if="required" class="required-marker" :aria-label="$t('common.required')">*</span>
    </label>

    <div class="form-field-input">
      <slot :id="fieldId" />
    </div>

    <p v-if="error" class="form-field-error">{{ error }}</p>
    <p v-else-if="helper" class="form-field-helper">{{ helper }}</p>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

let fieldIdCounter = 0;

export default defineComponent({
  name: "FormField",

  props: {
    label: { type: String, default: "" },
    helper: { type: String, default: "" },
    error: { type: String, default: "" },
    required: { type: Boolean, default: false },
  },

  data: () => ({
    fieldId: `field-${++fieldIdCounter}`,
  }),
});
</script>

<style scoped>
.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.required-marker {
  color: var(--accent-tertiary);
  font-weight: 700;
}

.form-field-helper {
  font-size: 11px;
  color: var(--text-tertiary);
  margin: 0;
  line-height: 1.5;
}

.form-field-error {
  font-size: 11px;
  color: var(--status-failed);
  margin: 0;
}

.has-error .form-field-input :deep(input),
.has-error .form-field-input :deep(select),
.has-error .form-field-input :deep(textarea) {
  border-color: var(--status-failed);
  box-shadow: 0 0 0 2px rgba(255, 77, 109, 0.15);
}
</style>
