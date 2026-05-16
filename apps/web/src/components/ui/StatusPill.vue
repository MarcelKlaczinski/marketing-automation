<template>
  <div
    class="status-pill"
    :class="`pill-${status}`"
    :title="status"
    :aria-label="status"
    role="img"
  />
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

type PillStatus = "done" | "running" | "failed" | "queued" | "idle";

/**
 * Compact visual dot indicator for article/cluster generation states.
 * Used inside ClusterArticlePills — renders as a 10×10 colored dot.
 * Running state uses the `pillFlow` shimmer animation from animations.css.
 */
export default defineComponent({
  name: "StatusPill",

  props: {
    status: {
      type: String as PropType<PillStatus>,
      required: true,
    },
  },
});
</script>

<style scoped>
.status-pill {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* === Done === */
.pill-done {
  background: var(--status-success);
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.4);
}

/* === Running — animated shimmer === */
.pill-running {
  background: linear-gradient(
    90deg,
    var(--status-running) 0%,
    rgba(0, 212, 255, 0.4) 50%,
    var(--status-running) 100%
  );
  background-size: 200% 100%;
  animation: pillFlow 1.4s ease-in-out infinite;
  box-shadow: 0 0 6px var(--accent-secondary-glow);
}

/* === Failed === */
.pill-failed {
  background: var(--status-failed);
  box-shadow: 0 0 6px rgba(255, 77, 109, 0.4);
}

/* === Queued === */
.pill-queued {
  background: var(--status-queued);
  box-shadow: 0 0 6px rgba(251, 191, 36, 0.3);
}

/* === Idle === */
.pill-idle {
  background: var(--border-medium);
}
</style>
