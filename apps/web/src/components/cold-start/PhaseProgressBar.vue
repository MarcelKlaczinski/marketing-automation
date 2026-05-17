<template>
  <nav class="phase-progress" :aria-label="$t('coldStart.phaseLabel', { current: currentPhase, total: totalPhases }) as string">
    <div class="phase-progress-track" aria-hidden="true">
      <div
        class="phase-progress-fill"
        :style="{ width: progressPercent + '%' }"
      />
    </div>

    <ol class="phase-list">
      <li
        v-for="phase in phases"
        :key="phase.number"
        class="phase-step"
        :class="{
          'phase-current': phase.number === currentPhase,
          'phase-completed': completedPhases.includes(phase.number),
        }"
      >
        <div class="phase-dot" :aria-hidden="true">
          <svg
            v-if="completedPhases.includes(phase.number)"
            class="check-icon"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="2,7 5.5,10.5 12,3.5" />
          </svg>
          <span v-else>{{ phase.number }}</span>
        </div>
        <span class="phase-label">
          {{ $t(`coldStart.phases.${phase.key}.label`) as string }}
        </span>
      </li>
    </ol>
  </nav>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

export default defineComponent({
  name: "PhaseProgressBar",

  props: {
    currentPhase: { type: Number, required: true },
    totalPhases: { type: Number, default: 5 },
    completedPhases: { type: Array as PropType<number[]>, required: true },
  },

  computed: {
    phases() {
      return [
        { number: 1, key: "basics" },
        { number: 2, key: "brand" },
        { number: 3, key: "seed" },
        { number: 4, key: "astro" },
        { number: 5, key: "confirm" },
      ];
    },
    progressPercent(): number {
      const highest = Math.max(0, ...this.completedPhases);
      return (highest / (this.totalPhases - 1)) * 100;
    },
  },
});
</script>

<style scoped>
.phase-progress {
  position: relative;
  padding: 24px 80px;
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
}

.phase-progress-track {
  position: absolute;
  top: calc(24px + 16px); /* top padding + half dot height */
  left: 80px;
  right: 80px;
  height: 2px;
  background: var(--border-subtle);
  z-index: 1;
}

.phase-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary, var(--accent-primary)));
  transition: width var(--transition-spring, 400ms cubic-bezier(0.34, 1.56, 0.64, 1));
  box-shadow: 0 0 12px rgba(124, 92, 255, 0.4);
}

.phase-list {
  display: flex;
  justify-content: space-between;
  position: relative;
  z-index: 2;
  list-style: none;
  margin: 0;
  padding: 0;
}

.phase-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.phase-dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--bg-base);
  border: 2px solid var(--border-medium);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  transition: background 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              border-color 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              color 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              box-shadow 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@keyframes pulseDot {
  0%, 100% { box-shadow: 0 0 8px rgba(124, 92, 255, 0.4); }
  50% { box-shadow: 0 0 20px rgba(124, 92, 255, 0.7); }
}

.phase-current .phase-dot {
  border-color: var(--accent-primary);
  color: var(--accent-primary);
  animation: pulseDot 2s ease-in-out infinite;
}

.phase-completed .phase-dot {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
  color: white;
  box-shadow: none;
}

.phase-label {
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  transition: color 200ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

.phase-current .phase-label {
  color: var(--text-primary);
}

.check-icon {
  display: block;
}

@media (max-width: 768px) {
  .phase-progress {
    padding: 16px 24px;
  }

  .phase-progress-track {
    top: calc(16px + 16px);
    left: 24px;
    right: 24px;
  }

  .phase-label {
    display: none;
  }
}
</style>
