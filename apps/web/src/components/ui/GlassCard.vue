<template>
  <component
    :is="tag"
    class="glass-card"
    :class="[
      `glass-${variant}`,
      {
        'glass-hover': hoverable,
        'glass-selected': selected,
      },
    ]"
  >
    <slot />
  </component>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

type CardVariant = "default" | "strong" | "elevated";

/**
 * Generic glassmorphism container.
 * Three visual variants: default (lightest), strong (more opaque), elevated (with shadow).
 * Optionally hoverable (lift effect) and selectable (violet glow border).
 */
export default defineComponent({
  name: "GlassCard",

  props: {
    /** HTML element or component to render as */
    tag: { type: String, default: "div" },
    /** Visual intensity variant */
    variant: {
      type: String as PropType<CardVariant>,
      default: "default",
    },
    /** Adds lift-on-hover transform */
    hoverable: { type: Boolean, default: false },
    /** Highlights with accent border + glow (e.g. selected pipeline run) */
    selected: { type: Boolean, default: false },
  },
});
</script>

<style scoped>
/* === Base === */
.glass-card {
  background: var(--bg-glass);
  backdrop-filter: var(--blur-glass-light);
  -webkit-backdrop-filter: var(--blur-glass-light);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  transition: background var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1)),
              border-color var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1)),
              box-shadow var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1)),
              transform var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1));
}

/* === Variants === */
.glass-strong {
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-glass);
  -webkit-backdrop-filter: var(--blur-glass);
  border-color: var(--border-soft);
}

.glass-elevated {
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-glass);
  -webkit-backdrop-filter: var(--blur-glass);
  border-color: var(--border-soft);
  box-shadow: var(--shadow-elevated);
}

/* === Modifiers === */
@media (hover: hover) and (pointer: fine) {
  .glass-hover:hover {
    background: var(--bg-glass-hover);
    border-color: var(--border-medium);
    transform: translateY(-2px);
    box-shadow: var(--shadow-elevated);
  }
}

.glass-hover:active {
  transform: translateY(0) scale(0.99);
  transition-duration: 160ms;
}

.glass-selected {
  border-color: var(--accent-primary);
  background: rgba(124, 92, 255, 0.08);
  box-shadow: var(--shadow-glow);
}
</style>
