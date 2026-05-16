<template>
  <span class="status-badge" :class="`badge-${variant}`">
    <slot>{{ label }}</slot>
  </span>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

type BadgeVariant =
  | "running"
  | "queued"
  | "failed"
  | "completed"
  | "partial"
  | "idle"
  | "pending";

/**
 * Text-based semantic status badge. Seven variants matching pipeline + cluster states.
 * Renders a small pill with colored text + tinted background.
 * Optional default slot overrides the `label` prop.
 */
export default defineComponent({
  name: "StatusBadge",

  props: {
    /** Semantic color variant */
    variant: {
      type: String as PropType<BadgeVariant>,
      required: true,
    },
    /** Display text — overridable via default slot */
    label: {
      type: String,
      default: "",
    },
  },
});
</script>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: 1px solid transparent;
  white-space: nowrap;
}

/* === Running === */
.badge-running {
  background: var(--status-running-bg);
  color: var(--status-running);
  border-color: rgba(0, 212, 255, 0.2);
}

/* === Queued === */
.badge-queued {
  background: var(--status-queued-bg);
  color: var(--status-queued);
  border-color: rgba(251, 191, 36, 0.2);
}

/* === Failed === */
.badge-failed {
  background: var(--status-failed-bg);
  color: var(--status-failed);
  border-color: rgba(255, 77, 109, 0.2);
}

/* === Completed === */
.badge-completed {
  background: var(--status-success-bg);
  color: var(--status-success);
  border-color: rgba(74, 222, 128, 0.2);
}

/* === Partial (some completed, some failed) === */
.badge-partial {
  background: rgba(251, 191, 36, 0.08);
  color: var(--status-queued);
  border-color: rgba(251, 191, 36, 0.15);
}

/* === Idle === */
.badge-idle {
  background: var(--bg-glass-strong);
  color: var(--text-tertiary);
  border-color: var(--border-subtle);
}

/* === Pending === */
.badge-pending {
  background: rgba(124, 92, 255, 0.08);
  color: var(--accent-primary);
  border-color: rgba(124, 92, 255, 0.2);
}
</style>
