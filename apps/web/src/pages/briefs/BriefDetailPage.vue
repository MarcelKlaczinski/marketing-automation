<template>
  <DetailPageShell
    :title="brief?.topicTitle ?? ''"
    :meta="briefMeta"
    :back-route="backRoute"
  >
    <template #eyebrow>
      <span class="source-badge mono">{{ brief?.source }}</span>
      <span
        v-if="brief"
        :class="['status-chip', `status-${brief.approvalStatus}`]"
      >
        {{ approvalStatusLabel }}
      </span>
    </template>

    <template #actions>
      <GlassButton
        v-if="brief?.approvalStatus === 'pending'"
        variant="primary"
        size="sm"
        @click="onApprove"
      >
        {{ $t("briefs.actions.approve") as string }}
      </GlassButton>
      <GlassButton
        v-if="brief?.approvalStatus === 'pending'"
        variant="ghost"
        size="sm"
        @click="onDismiss"
      >
        {{ $t("briefs.actions.dismiss") as string }}
      </GlassButton>
    </template>

    <div v-if="isPending" class="detail-loading">
      <LoadingShimmer variant="card" :count="2" />
    </div>

    <div v-else-if="brief" class="brief-detail-body">
      <section class="detail-section">
        <h2 class="section-title">{{ $t("briefs.detail.suggestion") as string }}</h2>
        <dl class="detail-list">
          <dt>{{ $t("briefs.fields.primaryKeyword") as string }}</dt>
          <dd class="mono">{{ brief.primaryKeyword ?? "—" }}</dd>
          <dt v-if="brief.clusterAction">{{ $t("briefs.fields.clusterAction") as string }}</dt>
          <dd v-if="brief.clusterAction" class="mono">{{ $t(`briefs.clusterAction.${brief.clusterAction}`) as string }}</dd>
        </dl>
      </section>

      <section v-if="trendScore !== null" class="detail-section">
        <h2 class="section-title">{{ $t("briefs.detail.trend") as string }}</h2>
        <div class="score-display">
          <span class="score-value mono">{{ trendScore }}</span>
          <span class="score-label">/ 100</span>
        </div>
      </section>
    </div>
  </DetailPageShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRoute } from "vue-router";
import { apiGet, apiPost } from "src/lib/api";
import DetailPageShell from "src/components/ui/DetailPageShell.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import type { BriefListItem } from "src/types/ui";

export default defineComponent({
  name: "BriefDetailPage",

  components: { DetailPageShell, GlassButton, LoadingShimmer },

  setup() {
    // Route param is static — component remounts on navigation to a different brief.
    const route = useRoute();
    const queryClient = useQueryClient();
    const briefId = route.params.briefId as string;

    const { data, isPending } = useQuery({
      queryKey: ["brief", briefId],
      queryFn: () => apiGet<{ brief: BriefListItem }>(`/briefs/${briefId}`),
    });

    return { briefId, data, isPending, queryClient };
  },

  computed: {
    approvalStatusLabel(): string {
      const status = this.brief?.approvalStatus;
      if (!status) return "";
      return this.$t(`briefs.approvalStatus.${status}`) as string;
    },
    brief(): BriefListItem | null {
      return (this.data as { brief: BriefListItem } | undefined)?.brief ?? null;
    },
    briefMeta(): string {
      if (!this.brief) return "";
      const sourceLabel = this.$t(`briefs.source.${this.brief.source}`) as string;
      const parts = [sourceLabel];
      if (this.brief.createdAt) {
        const d = new Date(this.brief.createdAt);
        parts.push(d.toLocaleDateString(this.$i18n.locale === "de" ? "de-DE" : "en-US"));
      }
      return parts.join(" · ");
    },
    trendScore(): number | null {
      const meta = this.brief?.trendMetadata;
      if (!meta?.scoreBreakdown?.total) return null;
      return typeof meta.scoreBreakdown.total === "number"
        ? Math.round(meta.scoreBreakdown.total)
        : null;
    },
    backRoute(): string {
      const slug = this.$route.params.slug as string;
      return `/projects/${slug}/briefs`;
    },
  },

  methods: {
    async onApprove(): Promise<void> {
      if (!this.brief) return;
      try {
        const slug = this.$route.params.slug as string;
        await apiPost(`/projects/${slug}/trends/${this.briefId}/approve`, {
          mode: "assist",
        });
        void this.queryClient.invalidateQueries({ queryKey: ["brief", this.briefId] });
        this.$q.notify({ type: "positive", message: this.$t("briefs.actions.approveSuccess") as string });
      } catch {
        // handled by api.ts
      }
    },
    async onDismiss(): Promise<void> {
      if (!this.brief) return;
      try {
        const slug = this.$route.params.slug as string;
        await apiPost(`/projects/${slug}/trends/${this.briefId}/dismiss`);
        void this.queryClient.invalidateQueries({ queryKey: ["brief", this.briefId] });
        this.$q.notify({ type: "info", message: this.$t("briefs.actions.dismissSuccess") as string });
        void this.$router.push(this.backRoute);
      } catch {
        // handled by api.ts
      }
    },
  },
});
</script>

<style scoped>
.detail-loading {
  padding: 24px;
}

.source-badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.status-chip {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 8px;
}

.status-pending { background: rgba(234, 179, 8, 0.15); color: #fbbf24; }
.status-approved, .status-auto_approved { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.status-rejected { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.status-routed { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }

.brief-detail-body {
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

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.detail-list {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 8px 12px;
  margin: 0;
}

.detail-list dt {
  font-size: 11px;
  color: var(--text-tertiary);
  padding-top: 2px;
}

.detail-list dd {
  font-size: 13px;
  color: var(--text-primary);
  margin: 0;
}

.score-display {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.score-value {
  font-size: 32px;
  font-weight: 700;
  color: #4ade80;
}

.score-label {
  font-size: 13px;
  color: var(--text-tertiary);
}
</style>
