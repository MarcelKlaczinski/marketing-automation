<template>
  <button
    class="glass-button"
    :class="[`btn-${variant}`, { 'btn-loading': loading }]"
    :disabled="disabled || loading"
    @click="$emit('click', $event)"
  >
    <span v-if="loading" class="btn-spinner" aria-hidden="true" />
    <slot v-else />
  </button>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "icon";

/**
 * Glassmorphism button — five variants:
 * - primary:   gradient violet→magenta, glow shadow (CTAs)
 * - secondary: glass background with border (default actions)
 * - ghost:     text-only, subtle hover (tertiary actions)
 * - danger:    red glass for destructive actions
 * - icon:      square 32×32 for icon-only buttons
 */
export default defineComponent({
  name: "GlassButton",

  emits: ["click"],

  props: {
    variant: {
      type: String as PropType<ButtonVariant>,
      default: "secondary",
    },
    /** Shows a spinner and disables interaction while true */
    loading: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
  },
});
</script>

<style scoped>
/* === Base === */
.glass-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-primary);
  transition: background var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1)),
              border-color var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1)),
              box-shadow var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1)),
              opacity var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
              transform var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
}

/* === Primary === */
.btn-primary {
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-tertiary) 100%);
  color: white;
  border-color: transparent;
  box-shadow: 0 4px 12px rgba(124, 92, 255, 0.3);
}

@media (hover: hover) and (pointer: fine) {
  .btn-primary:hover:not(:disabled) {
    box-shadow: 0 6px 16px rgba(124, 92, 255, 0.4);
    transform: translateY(-1px);
  }
}

.btn-primary:active:not(:disabled) {
  transform: scale(0.97);
  transition-duration: 160ms;
}

/* === Secondary === */
.btn-secondary {
  background: var(--bg-glass-strong);
  border-color: var(--border-soft);
}

@media (hover: hover) and (pointer: fine) {
  .btn-secondary:hover:not(:disabled) {
    background: var(--bg-glass-hover);
    border-color: var(--border-medium);
  }
}

.btn-secondary:active:not(:disabled) {
  transform: scale(0.97);
  transition-duration: 160ms;
}

/* === Ghost === */
.btn-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text-secondary);
}

@media (hover: hover) and (pointer: fine) {
  .btn-ghost:hover:not(:disabled) {
    background: var(--bg-glass-strong);
    color: var(--text-primary);
  }
}

.btn-ghost:active:not(:disabled) {
  transform: scale(0.97);
  transition-duration: 160ms;
}

/* === Danger === */
.btn-danger {
  background: var(--status-failed-bg);
  border-color: rgba(255, 77, 109, 0.3);
  color: var(--status-failed);
}

@media (hover: hover) and (pointer: fine) {
  .btn-danger:hover:not(:disabled) {
    background: rgba(255, 77, 109, 0.15);
    border-color: rgba(255, 77, 109, 0.5);
  }
}

.btn-danger:active:not(:disabled) {
  transform: scale(0.97);
  transition-duration: 160ms;
}

/* === Icon === */
.btn-icon {
  width: 32px;
  height: 32px;
  padding: 0;
  border-color: transparent;
  background: transparent;
  color: var(--text-secondary);
}

@media (hover: hover) and (pointer: fine) {
  .btn-icon:hover:not(:disabled) {
    background: var(--bg-glass-strong);
    color: var(--text-primary);
  }
}

.btn-icon:active:not(:disabled) {
  transform: scale(0.92);
  transition-duration: 160ms;
}

/* === Disabled === */
.glass-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none !important;
  box-shadow: none !important;
}

/* === Loading === */
.btn-loading {
  pointer-events: none;
}

.btn-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
</style>
