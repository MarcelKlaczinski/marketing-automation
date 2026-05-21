<template>
  <div class="run-detail-page">
    <header class="page-header">
      <router-link :to="{ name: 'runs-list', params: { slug: projectSlug } }" class="back-link">
        {{ $t("runs.detail.backToList") as string }}
      </router-link>

      <div v-if="detail" class="header-row">
        <h1 class="page-title mono">{{ shortRunId }}</h1>
        <span class="pipeline-name mono">{{ detail.run.pipelineName }}</span>
        <span class="status-badge" :class="`status-badge--${detail.run.status.replace(/_/g, '-')}`">
          {{ statusLabel(detail.run.status) }}
        </span>
      </div>

      <div v-if="detail" class="meta-row text-tertiary text-xs">
        <span>{{ $t("runs.detail.triggeredAt") as string }}: {{ formattedTriggered }}</span>
        <span v-if="detail.run.durationMs !== null">
          · {{ $t("runs.detail.durationLabel") as string }}: {{ formattedDuration }}
        </span>
        <span v-if="detail.totalCostEur > 0">
          · € {{ detail.totalCostEur.toFixed(4) }}
        </span>
      </div>
    </header>

    <div v-if="isPending" class="state-block">
      <p class="text-tertiary">{{ $t("runs.detail.loadingRun") as string }}</p>
    </div>
    <div v-else-if="!detail" class="state-block">
      <p class="text-secondary">{{ $t("runs.detail.runNotFound") as string }}</p>
    </div>
    <template v-else>
      <section class="steps-section">
        <h2 class="section-title">{{ $t("runs.detail.stepsSection") as string }}</h2>
        <StepCard
          v-for="(step, idx) in detail.steps"
          :key="step.id"
          :step="step"
          :step-index="idx"
          :run-id="detail.run.id"
          :project-slug="projectSlug"
          :initially-expanded="step.pause !== null && step.pause.resolvedAt === null"
          @action-completed="onActionCompleted"
        />
      </section>
    </template>
  </div>
</template>

<script lang="ts">
import StepCard from "src/components/runs/StepCard.vue";
import { type RunDetailResponse, useRunDetail } from "src/composables/runs/useRunDetail";
import { useProjectStore } from "src/stores/project";
import { defineComponent, ref } from "vue";

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
  name: "RunDetailPage",

  components: { StepCard },

  setup() {
    const projectStore = useProjectStore();
    // `runId` is a ref so the composable's reactive watch fires when the route param
    // changes (Vue Router usually remounts on param change, but we keep this defensive
    // wiring). Populate in mounted() from $route.params.
    const runId = ref<string>("");
    const detailQ = useRunDetail(runId);
    return {
      projectSlug: projectStore.currentSlug ?? "",
      runId,
      detailQ,
    };
  },

  mounted() {
    const id = this.$route.params.runId;
    this.runId = Array.isArray(id) ? (id[0] ?? "") : (id ?? "");
  },

  computed: {
    detail(): RunDetailResponse | null {
      return this.detailQ.detail.value;
    },
    isPending(): boolean {
      return this.detailQ.isPending.value;
    },
    shortRunId(): string {
      const id = this.detail?.run.id ?? "";
      return id ? `#${id.slice(0, 8)}` : "";
    },
    formattedTriggered(): string {
      const v = this.detail?.run.createdAt;
      if (!v) return "";
      const d = new Date(v);
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return d.toLocaleString(locale);
    },
    formattedDuration(): string {
      const ms = this.detail?.run.durationMs ?? 0;
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
      return `${(ms / 60_000).toFixed(1)}m`;
    },
  },

  watch: {
    "$route.params.runId"(next: string | string[] | undefined) {
      this.runId = Array.isArray(next) ? (next[0] ?? "") : (next ?? "");
    },
  },

  methods: {
    statusLabel(status: string): string {
      const key = STATUS_LABEL_KEYS[status] ?? "runs.list.statusFailed";
      return this.$t(key) as string;
    },
    onActionCompleted(): void {
      void this.detailQ.refetch();
    },
  },
});
</script>

<style scoped>
.run-detail-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-5);
  max-width: 1080px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.back-link {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 13px;
  align-self: flex-start;
}

.back-link:hover {
  color: var(--text-primary);
}

.header-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.pipeline-name {
  color: var(--text-secondary);
  font-size: 14px;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid transparent;
}
.status-badge--queued { background: var(--bg-glass-strong); color: var(--text-secondary); }
.status-badge--running { background: var(--status-running-bg); color: var(--status-running); }
.status-badge--paused { background: rgba(255, 188, 0, 0.08); color: #ffbc00; }
.status-badge--completed { background: rgba(34, 197, 94, 0.08); color: #22c55e; }
.status-badge--failed { background: var(--status-failed-bg); color: var(--status-failed); }
.status-badge--cancelled { background: var(--bg-glass-strong); color: var(--text-tertiary); }
.status-badge--batch-pending { background: var(--bg-glass-strong); color: var(--text-secondary); }
.status-badge--superseded { background: var(--bg-glass-strong); color: var(--text-tertiary); text-decoration: line-through; }

.meta-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.state-block {
  padding: var(--space-5);
  border-radius: var(--radius-md);
  background: var(--bg-glass);
  border: 1px dashed var(--border-subtle);
  text-align: center;
}

.steps-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
</style>
