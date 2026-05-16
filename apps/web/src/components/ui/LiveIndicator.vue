<template>
  <span class="live-indicator" aria-label="Live">
    <span class="live-dot-wrap" aria-hidden="true">
      <span class="live-ring" />
      <span class="live-dot" />
    </span>
    <span class="live-label">LIVE</span>
  </span>
</template>

<script lang="ts">
import { defineComponent } from "vue";

/**
 * Cyan "LIVE" indicator used in the dashboard header when there are active
 * pipeline runs. Shows a pulsing ring around a dot + the text "LIVE".
 * Animation: livePulse keyframe from animations.css.
 */
export default defineComponent({
  name: "LiveIndicator",
});
</script>

<style scoped>
.live-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 6px;
  border-radius: 20px;
  background: var(--status-running-bg);
  border: 1px solid rgba(0, 212, 255, 0.2);
}

/* Dot + ring wrapper — relative so absolute children are contained */
.live-dot-wrap {
  position: relative;
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Outer pulsing ring */
.live-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1.5px solid var(--status-running);
  animation: livePulse 1.4s ease-out infinite;
}

/* Inner solid dot */
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--status-running);
  box-shadow: 0 0 6px var(--accent-secondary-glow);
  flex-shrink: 0;
}

/* Text label */
.live-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--status-running);
  line-height: 1;
}
</style>
