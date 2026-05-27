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
      <!--
        Spec 65.5 — Recurring-source briefs land in `plan_pending` directly
        (they're auto-queued for the next Planner cycle). For those Marcel
        only needs the "Sofort generieren" path (skip queue, run now) +
        Dismiss; the "Plan"-Button is hidden because the brief is already
        queued for plan. Spec 65.10's `approveRecurringBrief` accepts
        `pending ∪ plan_pending` on the backend.
      -->
      <GlassButton
        v-if="brief?.approvalStatus === 'pending'"
        variant="primary"
        size="sm"
        @click="onApprovePlan"
      >
        {{ $t("briefs.bulkApprove.plan") as string }}
      </GlassButton>
      <GlassButton
        v-if="isApprovable"
        variant="secondary"
        size="sm"
        @click="onApproveImmediateClick"
      >
        {{ $t("briefs.bulkApprove.immediate") as string }}
      </GlassButton>
      <GlassButton
        v-if="isApprovable"
        variant="ghost"
        size="sm"
        @click="onDismiss"
      >
        {{ $t("briefs.actions.dismiss") as string }}
      </GlassButton>
    </template>

    <!-- Spec 63.6: confirm-destructive gate for 'Immediate' dispatch. -->
    <q-dialog v-model="showImmediateConfirm">
      <div class="immediate-confirm">
        <h2 class="confirm-title">{{ $t("briefs.bulkApprove.immediateConfirmTitle") as string }}</h2>
        <p class="confirm-body">{{ $t("briefs.bulkApprove.immediateHint") as string }}</p>
        <div class="confirm-actions">
          <GlassButton variant="ghost" size="sm" @click="showImmediateConfirm = false">
            {{ $t("common.cancel") as string }}
          </GlassButton>
          <GlassButton variant="danger" size="sm" @click="onApproveImmediateConfirm">
            {{ $t("briefs.bulkApprove.immediate") as string }}
          </GlassButton>
        </div>
      </div>
    </q-dialog>

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
    const slug = route.params.slug as string;

    const { data, isPending } = useQuery({
      queryKey: ["brief", briefId],
      queryFn: () => apiGet<{ brief: BriefListItem }>(`/projects/${slug}/briefs/${briefId}`),
    });

    return { briefId, slug, data, isPending, queryClient };
  },

  data: () => ({
    showImmediateConfirm: false,
  }),

  computed: {
    approvalStatusLabel(): string {
      const status = this.brief?.approvalStatus;
      if (!status) return "";
      return this.$t(`briefs.approvalStatus.${status}`) as string;
    },
    brief(): BriefListItem | null {
      return (this.data as { brief: BriefListItem } | undefined)?.brief ?? null;
    },
    /**
     * A brief is approvable from the detail page when its status is in the
     * "open" set per the partial-unique-index `topic_briefs_unique_open_per_gap`
     * (migration 0084): `pending` (default initial state) or `plan_pending`
     * (recurring-source default + manual dispatch=plan). Other states
     * (`approved`, `routed`, `auto_approved`, `rejected`, `superseded`) are
     * terminal-or-already-actioned and the action buttons stay hidden.
     */
    isApprovable(): boolean {
      const s = this.brief?.approvalStatus;
      return s === "pending" || s === "plan_pending";
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
      // Preserve the list's source / readiness filter on Back navigation.
      const slug = this.$route.params.slug as string;
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(this.$route.query)) {
        if (typeof value === "string") qs.set(key, value);
        else if (Array.isArray(value)) {
          const first = value.find((v) => typeof v === "string");
          if (typeof first === "string") qs.set(key, first);
        }
      }
      const suffix = qs.toString();
      return `/projects/${slug}/briefs${suffix ? `?${suffix}` : ""}`;
    },
  },

  methods: {
    async onApprovePlan(): Promise<void> {
      await this.approveWithDispatch("plan");
    },
    onApproveImmediateClick(): void {
      // Show confirm dialog — Marcel must opt in to bypassing the Budget Gate.
      this.showImmediateConfirm = true;
    },
    async onApproveImmediateConfirm(): Promise<void> {
      this.showImmediateConfirm = false;
      await this.approveWithDispatch("immediate");
    },
    /**
     * Spec 63.6 single-approve via the universal bulk-approve endpoint (single-
     * element list). dispatch='plan' (default) flips the brief to plan_pending
     * for next Planner cycle; dispatch='immediate' triggers article:blog inline.
     */
    async approveWithDispatch(dispatch: "plan" | "immediate"): Promise<void> {
      if (!this.brief) return;
      try {
        const slug = this.$route.params.slug as string;
        const res = await apiPost<{
          dispatch: "plan" | "immediate";
          approvedCount: number;
          planQueuedCount: number;
          skippedCount: number;
          failedCount: number;
          results: {
            approved: Array<{ briefId: string }>;
            planQueued: Array<{ briefId: string }>;
            skipped: Array<{ briefId: string; reason: string }>;
            failed: Array<{ briefId: string; error: string }>;
          };
        }>(`/projects/${slug}/briefs/bulk-approve`, {
          briefIds: [this.briefId],
          mode: "assist",
          dispatch,
        });
        void this.queryClient.invalidateQueries({ queryKey: ["brief", this.briefId] });
        void this.queryClient.invalidateQueries({ queryKey: ["briefs", slug] });
        const planQueued = res.planQueuedCount ?? 0;
        const approved = res.approvedCount ?? 0;
        if (planQueued > 0 || approved > 0) {
          const successKey =
            dispatch === "plan"
              ? "briefs.bulkApprove.planSuccess"
              : "briefs.bulkApprove.immediateSuccess";
          this.$q.notify({
            type: "positive",
            message: this.$t(successKey, {
              count: dispatch === "plan" ? planQueued : approved,
            }) as string,
          });
          void this.$router.push(this.backRoute);
        } else if (res.skippedCount > 0) {
          const reason = res.results.skipped[0]?.reason ?? "skipped";
          this.$q.notify({ type: "warning", message: reason });
        } else {
          const err = res.results.failed[0]?.error ?? "approve_failed";
          this.$q.notify({ type: "negative", message: err });
        }
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "approve_failed",
        });
      }
    },
    async onDismiss(): Promise<void> {
      if (!this.brief) return;
      try {
        const slug = this.$route.params.slug as string;
        await apiPost(`/projects/${slug}/briefs/bulk-dismiss`, {
          briefIds: [this.briefId],
        });
        void this.queryClient.invalidateQueries({ queryKey: ["brief", this.briefId] });
        void this.queryClient.invalidateQueries({ queryKey: ["briefs", slug] });
        this.$q.notify({ type: "info", message: this.$t("briefs.actions.dismissSuccess") as string });
        void this.$router.push(this.backRoute);
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "dismiss_failed",
        });
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
.status-plan_pending { background: rgba(99, 102, 241, 0.15); color: #818cf8; }
.status-approved, .status-auto_approved { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.status-rejected { background: rgba(239, 68, 68, 0.15); color: #f87171; }
.status-routed { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }

/* Spec 63.6: confirm-destructive dialog for 'immediate' dispatch. */
.immediate-confirm {
  background: var(--bg-surface);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 380px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.confirm-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.confirm-body {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

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
