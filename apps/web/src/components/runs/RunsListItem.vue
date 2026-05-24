<template>
  <router-link :to="targetRoute" class="runs-list-item">
    <div class="row-top">
      <span class="timestamp mono">{{ formattedTimestamp }}</span>
      <span class="pipeline-name mono">{{ run.pipelineName }}</span>
      <span v-if="run.stepCount > 0" class="step-count-badge mono">
        {{ stepCountLabel }}
      </span>
      <span class="status-badge" :class="statusClass">{{ statusLabel }}</span>
    </div>

    <div class="row-bottom">
      <span class="title text-secondary">{{ runTitle }}</span>
      <span v-if="run.errorMessage" class="error-snippet text-xs">
        {{ truncatedError }}
      </span>
    </div>
  </router-link>
</template>

<script lang="ts">
import type { PipelineRunRow } from "src/composables/runs/useRunsList";
import { type PropType, defineComponent } from "vue";

const STATUS_LABEL_KEYS: Record<string, string> = {
  queued: "runs.list.statusQueued",
  running: "runs.list.statusRunning",
  paused: "runs.list.statusPaused",
  completed: "runs.list.statusCompleted",
  failed: "runs.list.statusFailed",
  cancelled: "runs.list.statusCancelled",
  batch_pending: "runs.list.statusBatchPending",
  superseded: "runs.list.statusSuperseded",
};

export default defineComponent({
  name: "RunsListItem",

  props: {
    run: { type: Object as PropType<PipelineRunRow>, required: true },
    projectSlug: { type: String, required: true },
  },

  computed: {
    formattedTimestamp(): string {
      const d = new Date(this.run.startedAt ?? this.run.createdAt);
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return d.toLocaleString(locale, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    },
    statusLabel(): string {
      const key = STATUS_LABEL_KEYS[this.run.status] ?? "runs.list.statusFailed";
      return this.$t(key) as string;
    },
    stepCountLabel(): string {
      // Spec 64.19 / Phase A: inline "N steps" hint so the parent-children
      // relationship is discoverable without navigating to detail.
      return this.$t("runs.list.stepCount", { n: this.run.stepCount }, this.run.stepCount) as string;
    },
    statusClass(): string {
      return `status-badge--${this.run.status.replace(/_/g, "-")}`;
    },
    runTitle(): string {
      // Extract a friendly title from input.year/week (planner) or fall back to input snippet.
      const input = this.run.input ?? {};
      if (typeof input.targetYear === "number" && typeof input.targetIsoWeek === "number") {
        return (
          (this.$t("planner.title") as string) +
          " KW " +
          String(input.targetIsoWeek) +
          "/" +
          String(input.targetYear)
        );
      }
      return this.run.pipelineName;
    },
    truncatedError(): string {
      if (!this.run.errorMessage) return "";
      return this.run.errorMessage.length > 140
        ? this.run.errorMessage.slice(0, 137) + "..."
        : this.run.errorMessage;
    },
    targetRoute(): { name: string; params: Record<string, string> } {
      return {
        name: "run-detail",
        params: { slug: this.projectSlug, runId: this.run.id },
      };
    },
  },
});
</script>

<style scoped>
.runs-list-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  text-decoration: none;
  color: inherit;
  transition: background 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              border-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .runs-list-item:hover {
    background: var(--bg-glass-strong);
    border-color: var(--border-strong);
  }
}

.runs-list-item:active {
  transform: scale(0.997);
  transition-duration: 160ms;
}

.row-top {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.row-bottom {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.timestamp {
  color: var(--text-tertiary);
  font-size: 12px;
  white-space: nowrap;
}

.pipeline-name {
  color: var(--text-primary);
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title {
  font-size: 13px;
}

.error-snippet {
  color: var(--status-failed, #ff4d6d);
  margin-top: 2px;
}

.step-count-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 500;
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-subtle);
  color: var(--text-tertiary);
  white-space: nowrap;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid transparent;
  white-space: nowrap;
}

.status-badge--queued { background: var(--bg-glass-strong); color: var(--text-secondary); border-color: var(--border-subtle); }
.status-badge--running { background: var(--status-running-bg); color: var(--status-running); border-color: rgba(0, 212, 255, 0.2); }
.status-badge--paused { background: rgba(255, 188, 0, 0.08); color: #ffbc00; border-color: rgba(255, 188, 0, 0.25); }
.status-badge--completed { background: rgba(34, 197, 94, 0.08); color: #22c55e; border-color: rgba(34, 197, 94, 0.25); }
.status-badge--failed { background: var(--status-failed-bg); color: var(--status-failed); border-color: rgba(255, 77, 109, 0.25); }
.status-badge--cancelled { background: var(--bg-glass-strong); color: var(--text-tertiary); border-color: var(--border-subtle); }
.status-badge--batch-pending { background: var(--bg-glass-strong); color: var(--text-secondary); border-color: var(--border-subtle); }
.status-badge--superseded { background: var(--bg-glass-strong); color: var(--text-tertiary); border-color: var(--border-subtle); text-decoration: line-through; }

@media (max-width: 767px) {
  .runs-list-item {
    min-height: 44px;
  }
}
</style>
