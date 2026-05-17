<template>
  <div class="runs-tab">
    <LoadingShimmer v-if="isPending" variant="card" :count="3" />
    <EmptyState
      v-else-if="!runs.length"
      :title="$t('articles.runsTab.noRuns') as string"
    />
    <div v-else class="runs-list">
      <div
        v-for="run in runs"
        :key="run.id"
        class="run-row"
        :class="`run-${run.status}`"
      >
        <div class="run-type mono">{{ run.type ?? run.pipelineName }}</div>
        <div class="run-status">
          <span :class="['status-dot', `dot-${run.status}`]" />
          <span class="status-label">{{ run.status }}</span>
        </div>
        <div class="run-meta mono">
          <span v-if="run.costEur != null">€{{ parseFloat(run.costEur).toFixed(3) }}</span>
          <span v-if="run.durationMs != null">{{ Math.round(run.durationMs / 1000) }}s</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet } from "src/lib/api";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import EmptyState from "src/components/ui/EmptyState.vue";

interface RunItem {
  id: string;
  type?: string;
  pipelineName: string;
  status: string;
  durationMs: number | null;
  costEur: string | null;
  createdAt: string;
}

export default defineComponent({
  name: "ArticleRunsTab",

  components: { LoadingShimmer, EmptyState },

  props: {
    articleId: { type: String, required: true },
  },

  setup(props) {
    const { data, isPending } = useQuery({
      queryKey: ["article-runs", props.articleId],
      queryFn: () =>
        apiGet<{ runs: RunItem[] }>(
          `/articles/${props.articleId}/runs`,
        ),
    });
    return { data, isPending };
  },

  computed: {
    runs(): RunItem[] {
      return (this.data as { runs: RunItem[] } | undefined)?.runs ?? [];
    },
  },
});
</script>

<style scoped>
.runs-tab {
  padding: 16px;
}

.runs-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.run-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.run-type {
  font-size: 11px;
  color: var(--text-tertiary);
  min-width: 120px;
}

.run-status {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-completed, .dot-succeeded { background: #4ade80; }
.dot-running { background: #60a5fa; }
.dot-failed, .dot-errored { background: #f87171; }
.dot-queued, .dot-pending { background: #fbbf24; }

.status-label {
  font-size: 12px;
  color: var(--text-secondary);
}

.run-meta {
  display: flex;
  gap: 8px;
  font-size: 10px;
  color: var(--text-tertiary);
  margin-left: auto;
}
</style>
