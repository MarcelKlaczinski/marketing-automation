<template>
  <div class="empty-state" :class="{ 'empty-compact': compact }">
    <div v-if="icon" class="empty-icon-wrap" aria-hidden="true">
      <!-- Icon slot takes precedence over named SVG icons -->
      <slot name="icon">
        <span class="empty-icon-text">{{ icon }}</span>
      </slot>
    </div>

    <div class="empty-body">
      <p class="empty-title text-sm">{{ title }}</p>
      <p v-if="description" class="empty-description text-xs text-tertiary">
        {{ description }}
      </p>
    </div>

    <div v-if="$slots.action" class="empty-action">
      <slot name="action" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

/**
 * Empty state placeholder. Used when a list or section has no data.
 * Slots:
 *   - icon (optional) — custom SVG/component; falls back to `icon` prop text
 *   - action (optional) — CTA button/link below the description
 */
export default defineComponent({
  name: "EmptyState",

  props: {
    /** Emoji or short text icon. Ignored when #icon slot is provided. */
    icon: {
      type: String,
      default: "",
    },
    /** Heading text (required) */
    title: {
      type: String,
      required: true,
    },
    /** Supporting description below the title */
    description: {
      type: String,
      default: "",
    },
    /** Tighter layout for use inside small containers */
    compact: {
      type: Boolean,
      default: false,
    },
  },
});
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-10) var(--space-6);
  text-align: center;
}

.empty-compact {
  padding: var(--space-6) var(--space-4);
  gap: var(--space-2);
}

/* Icon area */
.empty-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-soft);
}

.empty-compact .empty-icon-wrap {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
}

.empty-icon-text {
  font-size: 22px;
  line-height: 1;
}

.empty-compact .empty-icon-text {
  font-size: 16px;
}

/* Body */
.empty-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-width: 260px;
}

.empty-title {
  color: var(--text-secondary);
  font-weight: 500;
  margin: 0;
}

.empty-description {
  margin: 0;
  line-height: 1.5;
}

/* Action */
.empty-action {
  margin-top: var(--space-1);
}
</style>
