<template>
  <div class="runs-list-page">
    <header class="page-header">
      <h1 class="page-title">{{ $t("runs.list.pageTitle") as string }}</h1>
      <p class="page-desc text-secondary">{{ $t("runs.list.pageDescription") as string }}</p>
    </header>

    <div class="filter-row">
      <div class="filter-group">
        <label class="filter-label">{{ $t("runs.list.filterPipeline") as string }}</label>
        <select v-model="pipelineNameLocal" class="filter-select">
          <option value="">{{ $t("runs.list.filterPipelineAll") as string }}</option>
          <option v-for="name in pipelineNames" :key="name" :value="name">{{ name }}</option>
        </select>
      </div>

      <div class="filter-group">
        <label class="filter-label">{{ $t("runs.list.filterStatus") as string }}</label>
        <select v-model="statusLocal" class="filter-select">
          <option value="">{{ $t("runs.list.filterStatusAll") as string }}</option>
          <option value="paused">{{ $t("runs.list.statusPaused") as string }}</option>
          <option value="running">{{ $t("runs.list.statusRunning") as string }}</option>
          <option value="queued">{{ $t("runs.list.statusQueued") as string }}</option>
          <option value="completed">{{ $t("runs.list.statusCompleted") as string }}</option>
          <option value="failed">{{ $t("runs.list.statusFailed") as string }}</option>
          <option value="cancelled">{{ $t("runs.list.statusCancelled") as string }}</option>
        </select>
      </div>

      <span class="sse-badge" :class="`sse-badge--${eventsStore.connectionStatus}`" :title="sseTitle">
        <span class="sse-dot" />
        {{ sseLabel }}
      </span>

      <GlassButton variant="ghost" @click="onRefresh">
        {{ $t("runs.list.refresh") as string }}
      </GlassButton>
    </div>

    <div v-if="isPending" class="state-block">
      <p class="text-tertiary">{{ $t("common.loading") as string }}</p>
    </div>
    <div v-else-if="runs.length === 0" class="state-block">
      <p class="text-secondary">{{ $t("runs.list.empty") as string }}</p>
      <p class="text-tertiary text-sm">{{ $t("runs.list.emptyHint") as string }}</p>
    </div>
    <div v-else class="runs-list">
      <RunsListItem
        v-for="run in runs"
        :key="run.id"
        :run="run"
        :project-slug="projectSlug"
      />
    </div>

    <div v-if="runs.length < total" class="load-more-row">
      <GlassButton variant="ghost" @click="onLoadMore">
        {{ $t("runs.list.loadMore") as string }}
      </GlassButton>
    </div>
  </div>
</template>

<script lang="ts">
import RunsListItem from "src/components/runs/RunsListItem.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import { useRunsList } from "src/composables/runs/useRunsList";
import { usePipelineEventsStore } from "src/stores/pipeline-events";
import { useProjectStore } from "src/stores/project";
import { defineComponent, ref } from "vue";

/**
 * Pipeline-runs list (Spec 62.6 §5.1).
 *
 * Filters:
 *  - pipelineNamePrefix (text) — defaults blank (all pipelines)
 *  - status (single value, comma-encoded for the API) — defaults blank
 *
 * URL sync: ?pipelineName=...&status=... (so deep-links and back/forward work).
 * SSE: shares the existing `usePipelineEvents` connection from MainLayout, so this
 * page does NOT spin up its own. The cache-invalidation listener already invalidates
 * `["pipeline-runs"]` on step.paused / step.resolved / run.statusChanged events.
 */
export default defineComponent({
  name: "RunsListPage",

  components: { GlassButton, RunsListItem },

  setup() {
    const route = useProjectStore();
    const pipelineName = ref<string | null>(null);
    const status = ref<string[]>([]);
    const limit = ref(50);
    const offset = ref(0);
    const list = useRunsList({ pipelineName, status, limit, offset });
    // Read shared events store; sse connection is established by MainLayout.
    const eventsStore = usePipelineEventsStore();
    return {
      projectSlug: route.currentSlug ?? "",
      list,
      pipelineName,
      status,
      limit,
      offset,
      eventsStore,
    };
  },

  data: () => ({
    pipelineNameLocal: "",
    statusLocal: "",
  }),

  computed: {
    runs() {
      return this.list.runs.value;
    },
    total() {
      return this.list.total.value;
    },
    isPending() {
      return this.list.isPending.value;
    },
    pipelineNames() {
      return this.list.pipelineNames.value;
    },
    sseLabel(): string {
      const map: Record<string, string> = {
        connected: "runs.list.sseConnected",
        connecting: "runs.list.sseConnecting",
        disconnected: "runs.list.sseDisconnected",
        error: "runs.list.sseError",
      };
      return this.$t(
        map[this.eventsStore.connectionStatus] ?? "runs.list.sseDisconnected"
      ) as string;
    },
    sseTitle(): string {
      return `SSE: ${this.eventsStore.connectionStatus}`;
    },
  },

  mounted() {
    // Read initial filters from URL query so deep-links work.
    const route = this.$route;
    const initialPipeline = Array.isArray(route.query.pipelineName)
      ? (route.query.pipelineName[0] ?? "")
      : ((route.query.pipelineName as string | undefined) ?? "");
    const initialStatus = Array.isArray(route.query.status)
      ? (route.query.status[0] ?? "")
      : ((route.query.status as string | undefined) ?? "");
    this.pipelineNameLocal = initialPipeline;
    this.statusLocal = initialStatus;
    this.syncFromLocal();
  },

  watch: {
    pipelineNameLocal(): void {
      this.offset = 0;
      this.syncFromLocal();
    },
    statusLocal(): void {
      this.offset = 0;
      this.syncFromLocal();
    },
  },

  methods: {
    syncFromLocal(): void {
      this.pipelineName = this.pipelineNameLocal || null;
      this.status = this.statusLocal ? [this.statusLocal] : [];
      // URL sync (replace so back-button isn't polluted).
      const q: Record<string, string> = {};
      if (this.pipelineNameLocal) q.pipelineName = this.pipelineNameLocal;
      if (this.statusLocal) q.status = this.statusLocal;
      void this.$router.replace({ query: q });
    },
    onLoadMore(): void {
      this.limit += 50;
    },
    onRefresh(): void {
      void this.list.refetch();
    },
  },
});
</script>

<style scoped>
.runs-list-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-5);
  max-width: 1080px;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  margin: 0 auto;
  width: 100%;
  padding-bottom: var(--space-7, 48px);
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.page-title { margin: 0; font-size: 22px; font-weight: 600; }
.page-desc { margin: 0; font-size: 14px; }

.filter-row {
  display: flex;
  align-items: flex-end;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-label {
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.filter-select {
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  padding: 6px 28px 6px 10px;
  font-size: 13px;
  min-width: 180px;
}

.sse-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  align-self: center;
  margin-left: auto;
}

.sse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.sse-badge--connected .sse-dot { background: #22c55e; }
.sse-badge--connecting .sse-dot { background: #ffbc00; }
.sse-badge--error .sse-dot { background: var(--status-failed, #ff4d6d); }

.state-block {
  padding: var(--space-5);
  border-radius: var(--radius-md);
  background: var(--bg-glass);
  border: 1px dashed var(--border-subtle);
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.runs-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.load-more-row {
  display: flex;
  justify-content: center;
}
</style>
