<template>
  <div class="step-timeline" role="list" :aria-label="$t('dashboard.detail.steps') as string">
    <div
      v-for="(step, i) in steps"
      :key="step.id"
      class="step-row"
      :class="`step-${step.status}`"
      role="listitem"
    >
      <!-- Connector line (before marker on all but first) -->
      <div class="step-connector-wrap">
        <div v-if="i > 0" class="step-connector" />
        <div class="step-marker" :class="`marker-${step.status}`">
          <svg v-if="step.status === 'completed'" width="8" height="8" viewBox="0 0 8 8" fill="none">
            <polyline points="1.5,4 3,5.5 6.5,2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <svg v-else-if="step.status === 'failed'" width="8" height="8" viewBox="0 0 8 8" fill="none">
            <line x1="2" y1="2" x2="6" y2="6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="6" y1="2" x2="2" y2="6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <div v-else-if="step.status === 'running'" class="marker-spinner" />
        </div>
      </div>

      <!-- Step info -->
      <div class="step-content">
        <div class="step-header">
          <span class="step-name text-sm">{{ step.stepName }}</span>
          <span v-if="step.durationMs !== null" class="step-duration mono text-xs text-dim">
            {{ formatDuration(step.durationMs) }}
          </span>
        </div>
        <p v-if="step.error && step.status === 'failed'" class="step-error text-xs">
          {{ step.error }}
        </p>
      </div>
    </div>

    <div v-if="steps.length === 0" class="step-empty text-sm text-tertiary">
      {{ $t('dashboard.detail.noSteps') }}
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

interface StepItem {
  id: string;
  stepName: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

/** Formats milliseconds as human-readable duration: "1.2s", "45s", "2m 3s" */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  return `${min}m ${remSec}s`;
}

/**
 * Vertical timeline of pipeline step executions.
 * Each step shows a status marker (spinner, check, X, dot), name, and duration.
 * The running step's marker animates.
 */
export default defineComponent({
  name: "PipelineStepTimeline",

  props: {
    steps: {
      type: Array as PropType<StepItem[]>,
      required: true,
    },
  },

  methods: {
    formatDuration(ms: number): string {
      return formatDuration(ms);
    },
  },
});
</script>

<style scoped>
.step-timeline {
  display: flex;
  flex-direction: column;
}

/* Row */
.step-row {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
}

/* Connector + marker column */
.step-connector-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  width: 16px;
}

.step-connector {
  width: 1px;
  height: 10px;
  background: var(--border-subtle);
  margin-bottom: 4px;
}

.step-marker {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-bottom: 10px;
}

.marker-pending {
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-soft);
  color: var(--text-dim);
}

.marker-running {
  background: rgba(0, 212, 255, 0.1);
  border: 1px solid var(--status-running);
  color: var(--status-running);
}

.marker-completed {
  background: rgba(74, 222, 128, 0.12);
  border: 1px solid var(--status-success);
  color: var(--status-success);
}

.marker-failed {
  background: rgba(255, 77, 109, 0.12);
  border: 1px solid var(--status-failed);
  color: var(--status-failed);
}

/* Spinning dot for running step */
.marker-spinner {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  animation: spin 0.7s linear infinite;
}

/* Content column */
.step-content {
  flex: 1;
  min-width: 0;
  padding-bottom: 10px;
}

.step-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.step-name {
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-duration {
  flex-shrink: 0;
}

.step-error {
  margin: 4px 0 0;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: var(--status-failed-bg);
  color: var(--status-failed);
  word-break: break-word;
  line-height: 1.4;
}

.step-empty {
  padding: var(--space-4) 0;
  text-align: center;
}

/* Status-specific row tinting */
.step-pending .step-name { color: var(--text-tertiary); }
.step-running .step-name { color: var(--status-running); }
</style>
