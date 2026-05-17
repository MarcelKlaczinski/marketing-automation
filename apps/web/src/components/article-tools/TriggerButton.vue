<template>
  <button
    class="trigger-button"
    :class="[`variant-${variant}`, { loading }]"
    :disabled="loading"
    @click="$emit('click')"
  >
    <div class="trigger-content">
      <h5 class="trigger-title">{{ title }}</h5>
      <p class="trigger-description">{{ description }}</p>
    </div>
    <div v-if="loading" class="trigger-spinner" aria-hidden="true" />
  </button>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "TriggerButton",

  emits: ["click"],

  props: {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    variant: { type: String, default: "default" },
    loading: { type: Boolean, default: false },
  },
});
</script>

<style scoped>
.trigger-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  background: var(--surface-secondary, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  transition:
    background 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    border-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
    transform 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.trigger-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (hover: hover) and (pointer: fine) {
  .trigger-button:not(:disabled):hover {
    background: var(--surface-primary, rgba(255, 255, 255, 0.08));
    border-color: var(--accent-primary, #7c5cff);
  }
}

.trigger-button:not(:disabled):active {
  transform: scale(0.97);
}

.trigger-button.variant-primary {
  border-color: var(--accent-primary, #7c5cff);
}

.trigger-button.variant-primary .trigger-title {
  color: var(--accent-primary, #7c5cff);
}

.trigger-content {
  flex: 1;
  min-width: 0;
}

.trigger-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trigger-description {
  font-size: 11px;
  color: var(--text-tertiary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trigger-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-soft);
  border-top-color: var(--accent-primary, #7c5cff);
  border-radius: 50%;
  flex-shrink: 0;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
