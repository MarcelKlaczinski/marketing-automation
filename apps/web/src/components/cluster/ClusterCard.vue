<template>
  <div class="cluster-card" :class="{ 'card-generating': isGenerating }">
    <!-- Scanline on running generation -->
    <div v-if="isGenerating" class="card-scanline" aria-hidden="true" />

    <!-- Header: name + status -->
    <div class="card-header">
      <div class="card-meta">
        <span v-if="pillarName" class="card-pillar text-xs text-dim">{{ pillarName }}</span>
        <h3 class="card-name text-sm">{{ name }}</h3>
      </div>
      <StatusBadge :variant="statusVariant" />
    </div>

    <!-- Article pills -->
    <ClusterArticlePills
      :hub-article="hubArticle"
      :spoke-articles="spokeArticles"
      :total-slots="totalSlots"
    />

    <!-- Footer: progress + cost -->
    <div class="card-footer">
      <span class="footer-progress text-xs text-tertiary">
        {{ $t('dashboard.clusters.progress', { done: progress.completed, total: progress.expected }) }}
      </span>
      <span v-if="costEur !== null" class="footer-cost mono text-xs text-dim">
        €{{ costEur.toFixed(2) }}
      </span>
    </div>

    <!-- Progress bar -->
    <div
      v-if="isGenerating && progress.expected > 0"
      class="progress-track"
      :aria-label="`${progress.percent}%`"
    >
      <div class="progress-fill" :style="{ width: `${progress.percent}%` }" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { useClusterStatus } from "src/composables/useClusterStatus";
import StatusBadge from "src/components/ui/StatusBadge.vue";
import ClusterArticlePills from "./ClusterArticlePills.vue";
import type { ClusterArticleStub } from "src/types/ui";

const ACTIVE_STATUSES = new Set(["running", "plan_proposed", "partial"]);

/**
 * Card for a single cluster in the DashboardClusters grid.
 * Fetches live generation status via useClusterStatus (30s polling + SSE invalidation).
 * Shows scanline animation while generating, article pills, and progress bar.
 */
export default defineComponent({
  name: "ClusterCard",

  components: { StatusBadge, ClusterArticlePills },

  props: {
    clusterId: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    pillarName: {
      type: String as PropType<string | null>,
      default: null,
    },
  },

  setup(props) {
    // MaybeRef — plain string works because useClusterStatus accepts MaybeRef<string>
    const { data: statusData, isLoading } = useClusterStatus(props.clusterId);
    return { statusData, isLoading };
  },

  computed: {
    clusterStatus(): string {
      return this.statusData?.cluster.generationStatus ?? "idle";
    },

    isGenerating(): boolean {
      return ACTIVE_STATUSES.has(this.clusterStatus);
    },

    statusVariant(): "running" | "queued" | "failed" | "completed" | "partial" | "idle" | "pending" {
      const s = this.clusterStatus;
      if (s === "running" || s === "plan_proposed") return "running";
      if (s === "partial") return "partial";
      if (s === "completed") return "completed";
      if (s === "failed") return "failed";
      return "idle";
    },

    hubArticle(): ClusterArticleStub | null {
      return this.statusData?.hubArticle ?? null;
    },

    spokeArticles(): ClusterArticleStub[] {
      return this.statusData?.spokeArticles ?? [];
    },

    totalSlots(): number {
      const expected = this.statusData?.progress.expected;
      // Default: 1 hub + 5 spokes × 2 locales = 12, capped
      return expected ?? 12;
    },

    progress(): { completed: number; expected: number; percent: number } {
      return this.statusData?.progress ?? { completed: 0, expected: 0, percent: 0 };
    },

    costEur(): number | null {
      const spent = this.statusData?.cost.spentEur;
      return spent ?? null;
    },
  },
});
</script>

<style scoped>
.cluster-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: 14px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  overflow: hidden;
  transition: border-color var(--transition-fast, 120ms cubic-bezier(0.4, 0, 0.2, 1));
}

.card-generating {
  border-color: rgba(0, 212, 255, 0.2);
}

/* Scanline animation (same as PipelineCard) */
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

/* Header */
.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.card-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.card-pillar {
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 9px;
  font-weight: 600;
}

.card-name {
  margin: 0;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Footer */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

/* Progress bar */
.progress-track {
  height: 2px;
  border-radius: 1px;
  background: var(--bg-glass-strong);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 1px;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
  transition: width var(--transition-base, 200ms cubic-bezier(0.4, 0, 0.2, 1));
}
</style>
