<template>
  <DetailPageShell
    :title="cluster?.name ?? ''"
    :meta="cluster ? `${cluster.pillarName ?? '—'} · ${cluster.primaryKeyword ?? '—'}` : ''"
    :back-route="backRoute"
  >
    <template #eyebrow>
      <span
        v-if="cluster"
        :class="['status-chip', `status-${cluster.generationStatus ?? 'idle'}`]"
      >
        {{ generationStatusLabel }}
      </span>
    </template>

    <template #actions>
      <GlassButton
        v-if="cluster?.generationStatus === 'partial'"
        variant="primary"
        size="sm"
        :loading="retrying"
        @click="onRetryFailedSpokes"
      >
        {{ $t("clusters.detailActions.retryFailed") as string }}
      </GlassButton>
      <GlassButton
        v-if="cluster?.generationStatus === 'plan_proposed'"
        variant="primary"
        size="sm"
        @click="onApprovePlan"
      >
        {{ $t("clusters.detailActions.approvePlan") as string }}
      </GlassButton>
    </template>

    <div v-if="isPending" class="detail-loading">
      <LoadingShimmer variant="card" :count="4" />
    </div>

    <div v-else-if="cluster" class="cluster-detail-body">
      <!-- Hub article -->
      <section v-if="hubArticle" class="detail-section">
        <h2 class="section-label">{{ $t("clusters.detail.hub") as string }}</h2>
        <div
          class="hub-card"
          role="button"
          tabindex="0"
          @click="navigateToArticle(hubArticle.id)"
          @keydown.enter="navigateToArticle(hubArticle.id)"
        >
          <span class="article-status mono">{{ hubArticleStatusLabel }}</span>
          <span class="article-title">{{ hubArticle.title ?? hubArticle.slug }}</span>
          <span class="article-locale mono">{{ hubArticle.locale }}</span>
        </div>
      </section>

      <!-- Spoke articles grid -->
      <section
        v-if="spokeArticles.length || pendingSpokeBriefIds.length"
        class="detail-section"
      >
        <h2 class="section-label">{{ $t("clusters.detail.spokes") as string }}</h2>
        <div class="spokes-grid">
          <SpokeArticleCard
            v-for="spoke in spokeArticles"
            :key="spoke.id"
            :article="spoke"
            :pipeline-run="runForArticle(spoke.id)"
            @click="navigateToArticle(spoke.id)"
            @retry="onRetrySpoke"
          />
          <PendingSpokeCard
            v-for="briefId in pendingSpokeBriefIds"
            :key="briefId"
          />
        </div>
      </section>

      <!-- Cost + Runs panels -->
      <section class="detail-section detail-meta-grid">
        <ClusterCostPanel :cost="cost" />
        <ClusterRunsPanel :runs="pipelineRuns" />
      </section>
    </div>
  </DetailPageShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useRoute } from "vue-router";
import { useClusterStatus } from "src/composables/useClusterStatus";
import { apiPost } from "src/lib/api";
import DetailPageShell from "src/components/ui/DetailPageShell.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import SpokeArticleCard from "src/components/cluster/SpokeArticleCard.vue";
import PendingSpokeCard from "src/components/cluster/PendingSpokeCard.vue";
import ClusterCostPanel from "src/components/cluster/ClusterCostPanel.vue";
import ClusterRunsPanel from "src/components/cluster/ClusterRunsPanel.vue";
import type { ClusterStatusResponse, ClusterPipelineRun } from "src/types/ui";

const STATUS_LABELS: Record<string, string> = {
  proposed: "clusters.generationStatus.proposed",
  plan_proposed: "clusters.generationStatus.plan_proposed",
  running: "clusters.generationStatus.running",
  completed: "clusters.generationStatus.completed",
  partial: "clusters.generationStatus.partial",
  failed: "clusters.generationStatus.failed",
  manual: "clusters.generationStatus.manual",
  idle: "clusters.generationStatus.idle",
};

export default defineComponent({
  name: "ClusterDetailPage",

  components: {
    DetailPageShell,
    GlassButton,
    LoadingShimmer,
    SpokeArticleCard,
    PendingSpokeCard,
    ClusterCostPanel,
    ClusterRunsPanel,
  },

  setup() {
    // Route param is static — component remounts on cluster navigation.
    const route = useRoute();
    const clusterId = route.params.clusterId as string;
    const { data, isPending, refetch } = useClusterStatus(clusterId);
    return { clusterId, data, isPending, refetch };
  },

  data: () => ({
    retrying: false,
  }),

  computed: {
    statusData(): ClusterStatusResponse | undefined {
      return this.data as ClusterStatusResponse | undefined;
    },
    cluster() {
      return this.statusData?.cluster ?? null;
    },
    hubArticle() {
      return this.statusData?.hubArticle ?? null;
    },
    spokeArticles() {
      return this.statusData?.spokeArticles ?? [];
    },
    cost() {
      return this.statusData?.cost ?? null;
    },
    progress() {
      return this.statusData?.progress ?? null;
    },
    pipelineRuns(): ClusterPipelineRun[] {
      return this.statusData?.pipelineRuns ?? [];
    },
    pendingSpokeBriefIds(): string[] {
      return this.statusData?.cluster?.pendingSpokeBriefIds ?? [];
    },
    generationStatusLabel(): string {
      const key = STATUS_LABELS[this.cluster?.generationStatus ?? ""];
      return key ? (this.$t(key) as string) : (this.cluster?.generationStatus ?? "");
    },
    hubArticleStatusLabel(): string {
      const status = this.hubArticle?.status;
      if (!status) return "";
      return this.$t(`articles.status.${status}`) as string;
    },
    backRoute(): string {
      const slug = this.$route.params.slug as string;
      return `/projects/${slug}/clusters`;
    },
  },

  methods: {
    runForArticle(articleId: string): ClusterPipelineRun | null {
      return this.pipelineRuns.find((r) => r.articleId === articleId) ?? null;
    },
    navigateToArticle(articleId: string): void {
      const slug = this.$route.params.slug as string;
      void this.$router.push(`/projects/${slug}/articles/${articleId}`);
    },
    async onRetrySpoke(runId: string): Promise<void> {
      try {
        await apiPost(`/pipeline-runs/${runId}/retry`);
        this.$q.notify({
          type: "positive",
          message: this.$t("clusters.detailActions.retrySuccess") as string,
        });
        void this.refetch();
      } catch {
        this.$q.notify({
          type: "negative",
          message: this.$t("clusters.detailActions.retryFailed2") as string,
        });
      }
    },
    async onRetryFailedSpokes(): Promise<void> {
      this.retrying = true;
      try {
        const slug = this.$route.params.slug as string;
        await apiPost(
          `/projects/${slug}/clusters/${this.clusterId}/retry-failed`,
        );
        this.$q.notify({
          type: "positive",
          message: this.$t("clusters.detailActions.retrySuccess") as string,
        });
        void this.refetch();
      } catch {
        this.$q.notify({
          type: "negative",
          message: this.$t("clusters.detailActions.retryFailed2") as string,
        });
      } finally {
        this.retrying = false;
      }
    },
    async onApprovePlan(): Promise<void> {
      try {
        const slug = this.$route.params.slug as string;
        await apiPost(
          `/projects/${slug}/clusters/${this.clusterId}/approve`,
        );
        this.$q.notify({
          type: "positive",
          message: this.$t("clusters.fullCluster.approveSuccess") as string,
        });
        void this.refetch();
      } catch {
        // handled by api interceptor
      }
    },
  },
});
</script>

<style scoped>
.detail-loading {
  padding: 24px;
}

.status-chip {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 8px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.status-completed { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.status-running { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.status-failed { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.status-partial { background: rgba(234, 179, 8, 0.15); color: #fbbf24; }
.status-plan_proposed, .status-proposed { background: rgba(255, 255, 255, 0.06); color: var(--text-tertiary); }
.status-idle, .status-manual { background: rgba(255, 255, 255, 0.04); color: var(--text-tertiary); }

.cluster-detail-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0;
}

.hub-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--bg-glass);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .hub-card:hover {
    border-color: var(--accent-primary);
  }
}

.article-status {
  font-size: 10px;
  color: var(--text-tertiary);
}

.article-title {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.article-locale {
  font-size: 10px;
  color: var(--text-tertiary);
}

.spokes-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}

.detail-meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  flex-direction: unset;
}

@media (max-width: 767px) {
  .detail-meta-grid {
    grid-template-columns: 1fr;
  }
}
</style>
