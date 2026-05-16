<template>
  <div class="run-detail">
    <!-- Loading state -->
    <template v-if="isLoading">
      <LoadingShimmer variant="line" height="12px" width="80px" />
      <LoadingShimmer variant="line" height="20px" width="100%" style="margin-top: 8px;" />
      <LoadingShimmer variant="card" height="180px" style="margin-top: 16px;" />
    </template>

    <!-- Error state -->
    <div v-else-if="isError" class="detail-error text-sm text-tertiary">
      {{ $t('dashboard.detail.loadError') }}
    </div>

    <!-- Content -->
    <template v-else-if="detail">
      <!-- Eyebrow: pipeline name + status pill -->
      <div class="detail-eyebrow">
        <span class="eyebrow-type label-caps text-dim text-xs">
          {{ detail.run.pipelineName }}
        </span>
        <StatusBadge :variant="statusVariant" />
      </div>

      <!-- Run ID -->
      <p class="detail-id mono text-xs text-dim">{{ detail.run.id }}</p>

      <!-- Timestamps -->
      <div v-if="detail.run.startedAt" class="detail-times text-xs text-tertiary">
        <span>{{ formatTime(detail.run.startedAt) }}</span>
        <span v-if="detail.run.durationMs !== null">
          · {{ formatDuration(detail.run.durationMs) }}
        </span>
      </div>

      <!-- Error box -->
      <div v-if="detail.run.error" class="detail-run-error text-xs">
        {{ detail.run.error }}
      </div>

      <!-- Article link -->
      <a
        v-if="detail.article"
        class="detail-article-link text-sm"
        :href="`/articles/${detail.article.id}`"
        target="_blank"
        rel="noopener"
      >
        {{ detail.article.title ?? detail.article.slug }}
        <span v-if="detail.article.locale" class="article-locale text-xs text-dim">
          ({{ detail.article.locale }})
        </span>
      </a>

      <!-- Divider -->
      <div class="detail-divider" />

      <!-- Step timeline -->
      <h4 class="section-label label-caps text-xs text-dim">
        {{ $t('dashboard.detail.steps') }}
      </h4>
      <PipelineStepTimeline :steps="detail.steps" />

      <!-- Divider -->
      <div class="detail-divider" />

      <!-- Cost grid -->
      <h4 class="section-label label-caps text-xs text-dim">
        {{ $t('dashboard.detail.cost') }}
      </h4>
      <div class="cost-grid">
        <div class="cost-cell">
          <span class="cost-label text-xs text-dim">{{ $t('dashboard.detail.costSpent') }}</span>
          <span class="cost-value mono text-sm">€{{ detail.totalCostEur.toFixed(4) }}</span>
        </div>
      </div>

      <!-- Divider -->
      <div class="detail-divider" />

      <!-- Action buttons -->
      <div class="detail-actions">
        <button
          v-if="detail.run.status === 'failed'"
          class="action-btn action-retry text-sm"
          :disabled="actionPending"
          @click="onRetry"
        >
          {{ $t('dashboard.detail.actions.retry') }}
        </button>

        <button
          v-if="detail.run.status === 'running' || detail.run.status === 'queued'"
          class="action-btn action-cancel text-sm"
          :disabled="actionPending"
          @click="onCancel"
        >
          {{ $t('dashboard.detail.actions.cancel') }}
        </button>

        <a
          v-if="detail.article"
          class="action-btn action-open text-sm"
          :href="`/articles/${detail.article.id}`"
          target="_blank"
          rel="noopener"
        >
          {{ $t('dashboard.detail.actions.open') }}
        </a>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useProjectStore } from "src/stores/project";
import { apiGet, apiPost, apiPatch } from "src/lib/api";
import StatusBadge from "src/components/ui/StatusBadge.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import PipelineStepTimeline from "./PipelineStepTimeline.vue";
import type { PipelineRunDetailResponse } from "src/types/ui";

/** Format ISO timestamp as locale-aware short time */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Format milliseconds as "1m 23s" / "45s" */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.round(sec % 60);
  return `${min}m ${remSec}s`;
}

/**
 * Right-pane detail view for a selected pipeline run.
 * Fetches enriched run data (steps + costs + article link).
 * Provides Retry / Cancel / Open actions.
 */
export default defineComponent({
  name: "PipelineRunDetail",

  components: { StatusBadge, LoadingShimmer, PipelineStepTimeline },

  props: {
    runId: {
      type: String,
      required: true,
    },
  },

  setup(props) {
    const projectStore = useProjectStore();
    const queryClient = useQueryClient();

    const { data: detail, isLoading, isError } = useQuery({
      queryKey: ["pipeline-run-detail", props.runId],
      queryFn: () => apiGet<PipelineRunDetailResponse>(`/pipeline-runs/${props.runId}`),
      refetchInterval: 5_000,
      staleTime: 2_000,
      enabled: !!props.runId,
    });

    return { detail, isLoading, isError, projectStore, queryClient };
  },

  data: () => ({
    actionPending: false,
  }),

  computed: {
    statusVariant(): "running" | "queued" | "failed" | "completed" | "partial" | "idle" | "pending" {
      const s = this.detail?.run.status ?? "pending";
      if (s === "running") return "running";
      if (s === "queued") return "queued";
      if (s === "failed") return "failed";
      if (s === "completed") return "completed";
      if (s === "cancelled") return "idle";
      return "pending";
    },
  },

  methods: {
    formatTime(iso: string): string {
      return formatTime(iso);
    },
    formatDuration(ms: number): string {
      return formatDuration(ms);
    },

    async onRetry(): Promise<void> {
      if (this.actionPending || !this.detail) return;
      this.actionPending = true;
      try {
        await apiPost(`/pipeline-runs/${this.detail.run.id}/retry`);
        await this.queryClient.invalidateQueries({ queryKey: ["activity-feed"] });
      } finally {
        this.actionPending = false;
      }
    },

    async onCancel(): Promise<void> {
      if (this.actionPending || !this.detail) return;
      this.actionPending = true;
      try {
        await apiPatch(`/pipeline-runs/${this.detail.run.id}/cancel`);
        await this.queryClient.invalidateQueries({ queryKey: ["pipeline-run-detail", this.detail.run.id] });
        await this.queryClient.invalidateQueries({ queryKey: ["activity-feed"] });
      } finally {
        this.actionPending = false;
      }
    },
  },
});
</script>

<style scoped>
.run-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  height: 100%;
}

/* Eyebrow */
.detail-eyebrow {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.detail-id {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.04em;
}

.detail-times {
  color: var(--text-tertiary);
}

/* Error */
.detail-run-error {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--status-failed-bg);
  color: var(--status-failed);
  border: 1px solid rgba(255, 77, 109, 0.2);
  word-break: break-word;
  line-height: 1.5;
}

.detail-error {
  padding: var(--space-4) 0;
  text-align: center;
}

/* Article link */
.detail-article-link {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--accent-primary);
  text-decoration: none;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-article-link:hover {
  text-decoration: underline;
}

/* Divider */
.detail-divider {
  height: 1px;
  background: var(--border-subtle);
  margin: var(--space-1) 0;
}

/* Section labels */
.section-label {
  margin: 0 0 var(--space-2);
  letter-spacing: 0.06em;
}

/* Cost grid */
.cost-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.cost-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cost-label {
  letter-spacing: 0.04em;
}

.cost-value {
  color: var(--text-primary);
  font-weight: 600;
}

/* Actions */
.detail-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-top: auto;
  padding-top: var(--space-2);
}

.action-btn {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-weight: 500;
  cursor: pointer;
  text-decoration: none;
  transition: opacity var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
  border: 1px solid transparent;
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.action-retry {
  background: rgba(0, 212, 255, 0.1);
  color: var(--status-running);
  border-color: rgba(0, 212, 255, 0.2);
}

.action-cancel {
  background: rgba(255, 77, 109, 0.1);
  color: var(--status-failed);
  border-color: rgba(255, 77, 109, 0.2);
}

.action-open {
  background: rgba(124, 92, 255, 0.1);
  color: var(--accent-primary);
  border-color: rgba(124, 92, 255, 0.2);
}
</style>
