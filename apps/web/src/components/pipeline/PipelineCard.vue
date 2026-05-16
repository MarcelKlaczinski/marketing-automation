<template>
  <div
    class="pipeline-card"
    :class="[`card-${run.status}`, { 'card-selected': selected }]"
    role="button"
    tabindex="0"
    :aria-label="run.title"
    :aria-pressed="selected"
    @click="$emit('select', run.id)"
    @keydown.enter="$emit('select', run.id)"
    @keydown.space.prevent="$emit('select', run.id)"
  >
    <!-- Running scanline animation -->
    <div v-if="run.status === 'running'" class="card-scanline" aria-hidden="true" />

    <!-- Header: type badge + elapsed/ago time -->
    <div class="card-header">
      <span class="type-badge" :class="`type-${normalizedType}`">
        {{ typeLabel }}
      </span>
      <span class="card-time mono text-dim text-xs">{{ timeDisplay }}</span>
    </div>

    <!-- Title -->
    <p class="card-title text-sm">{{ run.title }}</p>

    <!-- Progress bar (running only) -->
    <template v-if="run.status === 'running' && run.stepCount > 0">
      <div class="progress-bar-track" :aria-label="`${progressPercent}%`">
        <div class="progress-bar-fill" :style="{ width: `${progressPercent}%` }" />
      </div>
      <p v-if="run.currentStep" class="card-step text-xs text-tertiary">
        {{ run.currentStep }}
      </p>
    </template>

    <!-- Cost -->
    <div v-if="run.costEur !== null" class="card-footer">
      <span class="cost-label mono text-xs text-dim">
        €{{ run.costEur.toFixed(3) }}
      </span>
    </div>

    <!-- Error message (failed) -->
    <div v-if="run.status === 'failed' && run.errorMessage" class="card-error text-xs">
      {{ run.errorMessage }}
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { PipelineRunSummary } from "src/types/ui";

/** Maps pipeline type strings → i18n key paths */
const TYPE_I18N_KEYS: Record<string, string> = {
  blog: "dashboard.pipeline.types.blog",
  translation: "dashboard.pipeline.types.translation",
  refresh: "dashboard.pipeline.types.refresh",
  cluster: "dashboard.pipeline.types.cluster",
  "cluster-creator": "dashboard.pipeline.types.cluster-creator",
  "cold-start": "dashboard.pipeline.types.cold-start",
};

/** Maps pipeline type → CSS class suffix */
const TYPE_CSS: Record<string, string> = {
  blog: "blog",
  translation: "translation",
  refresh: "refresh",
  cluster: "cluster",
  "cluster-creator": "cluster",
  "cold-start": "setup",
};

/**
 * Card representing a single pipeline run. Used inside PipelineStatusLane.
 * Running state has scanline top-border animation.
 * Failed state shows error message box at bottom.
 */
export default defineComponent({
  name: "PipelineCard",

  emits: ["select"],

  props: {
    run: {
      type: Object as PropType<PipelineRunSummary>,
      required: true,
    },
    selected: {
      type: Boolean,
      default: false,
    },
  },

  computed: {
    normalizedType(): string {
      return TYPE_CSS[this.run.type] ?? "default";
    },

    typeLabel(): string {
      const key = TYPE_I18N_KEYS[this.run.type] ?? "dashboard.pipeline.types.default";
      return this.$t(key) as string;
    },

    progressPercent(): number {
      if (!this.run.stepCount) return 0;
      return Math.round((this.run.completedSteps / this.run.stepCount) * 100);
    },

    timeDisplay(): string {
      if (this.run.status === "running" && this.run.startedAt) {
        return formatElapsed(this.run.startedAt);
      }
      const ref = this.run.completedAt ?? this.run.startedAt ?? this.run.createdAt;
      return formatAgo(ref);
    },
  },
});

/** Format elapsed time as "0:42" */
function formatElapsed(startedAt: string): string {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const totalSec = Math.floor(elapsedMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

/** Format relative time as "2m ago" / "3h ago" / "1d ago" */
function formatAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "< 1m";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  return `${Math.floor(diffH / 24)}d`;
}
</script>

<style scoped>
/* === Base === */
.pipeline-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 10px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  cursor: pointer;
  outline: none;
  transition: background var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1)),
              border-color var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
  overflow: hidden;
}

@media (hover: hover) and (pointer: fine) {
  .pipeline-card:hover {
    background: var(--bg-glass-strong);
    border-color: var(--border-soft);
  }
}

.pipeline-card:focus-visible {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px var(--accent-primary-glow);
}

/* Selected */
.card-selected {
  border-color: var(--accent-primary) !important;
  background: rgba(124, 92, 255, 0.06) !important;
}

/* === Scanline for running === */
.card-scanline {
  position: absolute;
  inset: 0 0 auto 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--status-running) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: scanline 1.8s ease-in-out infinite;
}

/* === Header === */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

/* Type badge */
.type-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.type-blog       { background: rgba(0, 212, 255, 0.12); color: var(--status-running); }
.type-translation{ background: rgba(124, 92, 255, 0.12); color: var(--accent-primary); }
.type-refresh    { background: rgba(74, 222, 128, 0.12); color: var(--status-success); }
.type-cluster    { background: rgba(251, 191, 36, 0.12); color: var(--status-queued); }
.type-setup      { background: rgba(255, 92, 242, 0.12); color: var(--accent-tertiary); }
.type-default    { background: var(--bg-glass-strong); color: var(--text-tertiary); }

/* === Title === */
.card-title {
  margin: 0;
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.4;
}

/* === Progress bar === */
.progress-bar-track {
  height: 3px;
  border-radius: 2px;
  background: var(--bg-glass-strong);
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
  transition: width var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1));
}

.card-step {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* === Footer === */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

/* === Error message === */
.card-error {
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--status-failed-bg);
  color: var(--status-failed);
  border: 1px solid rgba(255, 77, 109, 0.2);
  word-break: break-word;
  line-height: 1.4;
}
</style>
