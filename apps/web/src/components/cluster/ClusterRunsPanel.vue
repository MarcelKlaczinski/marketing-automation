<template>
  <div class="runs-panel">
    <h3 class="panel-label">{{ $t("clusters.detail.runs") as string }}</h3>

    <div v-if="!runs.length" class="runs-empty mono">
      {{ $t("clusters.detail.noRuns") as string }}
    </div>

    <ul v-else class="runs-list">
      <li
        v-for="run in runs"
        :key="run.id"
        :class="['run-item', `run-${run.status}`]"
      >
        <div class="run-row">
          <span class="run-name mono">{{ run.pipelineName }}</span>
          <span :class="['run-status', `run-status-${run.status}`]">
            {{ runStatusLabel(run.status) }}
          </span>
        </div>
        <div class="run-meta mono">
          <span class="run-time">{{ formatDate(run.createdAt) }}</span>
          <span v-if="run.articleId" class="run-article">
            {{ run.articleId.slice(0, 8) }}…
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import type { PropType } from "vue";
import type { ClusterPipelineRun } from "src/types/ui";

const RUN_STATUS_KEY: Record<string, string> = {
  queued: "clusters.generationStatus.idle",
  running: "clusters.generationStatus.running",
  completed: "clusters.generationStatus.completed",
  failed: "clusters.detail.runFailed",
};

export default defineComponent({
  name: "ClusterRunsPanel",

  props: {
    runs: {
      type: Array as PropType<ClusterPipelineRun[]>,
      default: () => [],
    },
  },

  methods: {
    runStatusLabel(status: string): string {
      const key = RUN_STATUS_KEY[status];
      return key ? (this.$t(key) as string) : status;
    },
    formatDate(iso: string): string {
      const d = new Date(iso);
      return d.toLocaleString(
        this.$i18n.locale === "de" ? "de-DE" : "en-US",
        { dateStyle: "short", timeStyle: "short" },
      );
    },
  },
});
</script>

<style scoped>
.runs-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.panel-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0;
}

.runs-empty {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 4px 0;
}

.runs-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.run-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-sm);
  border-left: 2px solid transparent;
}

.run-failed { border-left-color: rgba(239, 68, 68, 0.5); }
.run-completed { border-left-color: rgba(34, 197, 94, 0.4); }
.run-running { border-left-color: rgba(59, 130, 246, 0.5); }

.run-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.run-name {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.run-status {
  font-size: 9px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 6px;
  flex-shrink: 0;
}

.run-status-completed { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.run-status-failed { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.run-status-running { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.run-status-queued { background: rgba(255, 255, 255, 0.06); color: var(--text-tertiary); }

.run-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.run-time {
  font-size: 9px;
  color: var(--text-tertiary);
}

.run-article {
  font-size: 9px;
  color: var(--text-tertiary);
  opacity: 0.7;
}
</style>
