<template>
  <div class="trend-detail">
    <!-- Not found -->
    <EmptyState
      v-if="!trend"
      :title="$t('trends.detail.emptyTitle') as string"
      :description="$t('trends.detail.emptyDescription') as string"
    />

    <template v-else>
      <!-- Header -->
      <div class="detail-header">
        <div class="header-eyebrow">
          <FreshnessBadge :freshness="trend.trendMetadata?.freshnessWindow ?? null" />
          <span v-if="trend.locale" class="locale-badge mono">{{ trend.locale }}</span>
        </div>

        <h2 class="detail-title">{{ trend.topicTitle }}</h2>
        <p v-if="trend.primaryKeyword" class="detail-keyword mono">{{ trend.primaryKeyword }}</p>

        <!-- Score large -->
        <div class="score-large">
          <span class="score-num mono" :class="scoreColorClass">
            {{ trendScore }}
          </span>
          <span class="score-label">{{ $t("trends.score") as string }}</span>
        </div>

        <!-- Action buttons -->
        <div class="action-row">
          <GlassButton
            variant="primary"
            :loading="approving"
            :disabled="dismissing"
            @click="onApprove"
          >
            {{ $t("trends.detail.approveQueue") as string }}
          </GlassButton>
          <GlassButton
            variant="ghost"
            :loading="dismissing"
            :disabled="approving"
            @click="onDismiss"
          >
            {{ $t("trends.detail.dismiss") as string }}
          </GlassButton>
        </div>

        <!-- cluster_assignment_required notice -->
        <div v-if="needsCluster" class="needs-cluster-notice">
          <p>{{ $t("trends.detail.routingCreateNew") as string }}</p>
          <router-link
            :to="`/projects/${$route.params.slug}/clusters/new?fromBrief=${trend.id}`"
            class="create-cluster-link"
          >
            {{ $t("trends.detail.createClusterAndGenerate") as string }}
          </router-link>
        </div>
      </div>

      <!-- Score breakdown -->
      <section class="detail-section">
        <h3 class="section-title">{{ $t("trends.detail.scoreBreakdown") as string }}</h3>
        <ScoreBreakdownChart
          v-if="trend.trendMetadata?.scoreBreakdown"
          :breakdown="trend.trendMetadata.scoreBreakdown"
        />
        <p v-else class="no-data mono">—</p>
      </section>

      <!-- Signals -->
      <section class="detail-section">
        <h3 class="section-title">{{ $t("trends.detail.signals") as string }}</h3>
        <SignalsList :signals="trend.trendMetadata?.signals ?? []" />
      </section>

      <!-- Suggested article -->
      <section class="detail-section">
        <h3 class="section-title">{{ $t("trends.detail.suggestedFields") as string }}</h3>
        <dl class="suggested-dl">
          <template v-if="trend.suggestedTitle">
            <dt>{{ $t("trends.detail.suggestedTitle") as string }}</dt>
            <dd>{{ trend.suggestedTitle }}</dd>
          </template>
          <template v-if="trend.suggestedSlug">
            <dt>{{ $t("trends.detail.suggestedSlug") as string }}</dt>
            <dd class="mono">{{ trend.suggestedSlug }}</dd>
          </template>
          <template v-if="trend.suggestedMeta">
            <dt>{{ $t("trends.detail.suggestedMeta") as string }}</dt>
            <dd>{{ trend.suggestedMeta }}</dd>
          </template>
          <dt>{{ $t("trends.detail.routingPreview") as string }}</dt>
          <dd>
            <span v-if="trend.clusterId">
              {{ $t("trends.detail.routingAppend", { cluster: trend.clusterName ?? trend.clusterId }) as string }}
            </span>
            <template v-else-if="trend.clusterAction === 'append_to_existing'">
              <div class="cluster-assign">
                <span class="cluster-assign-label">{{ $t("trends.detail.assignCluster") as string }}</span>
                <ClusterPicker
                  :model-value="pendingClusterId ?? ''"
                  @update:model-value="pendingClusterId = $event"
                />
                <GlassButton
                  v-if="pendingClusterId"
                  size="sm"
                  variant="secondary"
                  :loading="assigningCluster"
                  @click="onAssignCluster"
                >
                  {{ $t("trends.detail.assignClusterSave") as string }}
                </GlassButton>
              </div>
            </template>
            <span v-else-if="trend.clusterAction === 'create_new'">
              {{ $t("trends.clusterAction.create_new") as string }}
            </span>
            <span v-else>{{ $t("trends.detail.noCluster") as string }}</span>
          </dd>
        </dl>
      </section>

      <!-- Related event -->
      <section v-if="trend.trendMetadata?.relatedEvent" class="detail-section">
        <h3 class="section-title">{{ $t("trends.detail.relatedEvent") as string }}</h3>
        <p class="related-event">{{ trend.trendMetadata.relatedEvent }}</p>
      </section>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useTrendsList } from "src/composables/useTrendsList";
import { apiPost } from "src/lib/api";
import GlassButton from "src/components/ui/GlassButton.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import FreshnessBadge from "src/components/trends/FreshnessBadge.vue";
import ScoreBreakdownChart from "src/components/trends/ScoreBreakdownChart.vue";
import SignalsList from "src/components/trends/SignalsList.vue";
import ClusterPicker from "src/components/article-tools/ClusterPicker.vue";
import type { TrendBrief } from "src/composables/useTrendsList";

export default defineComponent({
  name: "TrendDetailPage",

  components: { GlassButton, EmptyState, FreshnessBadge, ScoreBreakdownChart, SignalsList, ClusterPicker },

  setup() {
    const { findTrend, invalidate } = useTrendsList();
    return { findTrend, invalidate };
  },

  data: () => ({
    approving: false,
    dismissing: false,
    needsCluster: false,
    pendingClusterId: null as string | null,
    assigningCluster: false,
  }),

  computed: {
    trendId(): string {
      return this.$route.params.trendId as string;
    },

    trend(): TrendBrief | undefined {
      return this.findTrend(this.trendId);
    },

    trendScore(): number {
      return this.trend?.trendMetadata?.trendScore ?? 0;
    },

    scoreColorClass(): string {
      if (this.trendScore >= 70) return "score-high";
      if (this.trendScore >= 40) return "score-medium";
      return "score-low";
    },
  },

  watch: {
    trendId(): void {
      this.needsCluster = false;
      this.pendingClusterId = null;
    },
  },

  methods: {
    async onApprove(): Promise<void> {
      if (!this.trend) return;
      this.approving = true;
      this.needsCluster = false;
      try {
        await apiPost(
          `/projects/${this.$route.params.slug as string}/trends/briefs/${this.trend.id}/approve`,
          { mode: "queue" },
        );
        this.$q.notify({ type: "positive", message: this.$t("trends.detail.approveSuccess") as string });
        void this.invalidate();
        void this.$router.push({
          name: "trends",
          params: { slug: this.$route.params.slug },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (msg === "cluster_assignment_required") {
          this.needsCluster = true;
        } else {
          this.$q.notify({ type: "negative", message: msg });
        }
      } finally {
        this.approving = false;
      }
    },

    async onAssignCluster(): Promise<void> {
      if (!this.trend || !this.pendingClusterId) return;
      this.assigningCluster = true;
      try {
        await apiPost(
          `/projects/${this.$route.params.slug as string}/trends/briefs/${this.trend.id}/edit`,
          { clusterId: this.pendingClusterId },
        );
        this.$q.notify({ type: "positive", message: this.$t("trends.detail.editSuccess") as string });
        void this.invalidate();
        this.pendingClusterId = null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        this.$q.notify({ type: "negative", message: msg });
      } finally {
        this.assigningCluster = false;
      }
    },

    async onDismiss(): Promise<void> {
      if (!this.trend) return;
      this.dismissing = true;
      try {
        await apiPost(
          `/projects/${this.$route.params.slug as string}/trends/briefs/${this.trend.id}/dismiss`,
          {},
        );
        this.$q.notify({ type: "positive", message: this.$t("trends.detail.dismissSuccess") as string });
        void this.invalidate();
        void this.$router.push({
          name: "trends",
          params: { slug: this.$route.params.slug },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        this.$q.notify({ type: "negative", message: msg });
      } finally {
        this.dismissing = false;
      }
    },
  },
});
</script>

<style scoped>
.trend-detail {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 0;
  max-width: 700px;
}

/* Header */
.detail-header {
  margin-bottom: 24px;
}

.header-eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.locale-badge {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 2px 6px;
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
}

.detail-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px;
  line-height: 1.35;
}

.detail-keyword {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0 0 14px;
}

.score-large {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 16px;
}

.score-num {
  font-size: 36px;
  font-weight: 800;
  line-height: 1;
}

.score-high { color: #10b981; }
.score-medium { color: #f59e0b; }
.score-low { color: var(--text-secondary); }

.score-label {
  font-size: 13px;
  color: var(--text-tertiary);
  font-weight: 500;
}

.action-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.needs-cluster-notice {
  margin-top: 12px;
  padding: 10px 12px;
  background: color-mix(in oklch, #f59e0b 10%, transparent);
  border: 1px solid color-mix(in oklch, #f59e0b 30%, transparent);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-primary);
}

.needs-cluster-notice p {
  margin: 0 0 6px;
}

.create-cluster-link {
  color: var(--accent-primary);
  text-decoration: none;
  font-weight: 600;
  font-size: 13px;
}

/* Sections */
.detail-section {
  padding: 16px 0;
  border-top: 1px solid var(--border-subtle);
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  margin: 0 0 12px;
}

.no-data {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0;
}

/* Suggested fields */
.suggested-dl {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 6px 12px;
  margin: 0;
}

.suggested-dl dt {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  align-self: start;
  padding-top: 1px;
}

.suggested-dl dd {
  font-size: 13px;
  color: var(--text-primary);
  margin: 0;
  word-break: break-word;
}

.cluster-assign {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cluster-assign-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 600;
}

.related-event {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

@media (max-width: 767px) {
  .trend-detail {
    padding: 14px 14px;
  }

  .suggested-dl {
    grid-template-columns: 1fr;
    gap: 2px 0;
  }

  .suggested-dl dt {
    margin-top: 8px;
  }
}
</style>
