<template>
  <div class="briefs-page">
    <aside class="list-pane">
      <div class="page-header">
        <h1 class="page-title">{{ $t("briefs.title") as string }}</h1>
        <!-- Spec 64.14 Phase C: manual brief creation entry point. -->
        <GlassButton variant="primary" size="sm" @click="onOpenCreate">
          {{ $t("briefs.create.open") as string }}
        </GlassButton>
      </div>

      <div class="filter-bar" role="group" :aria-label="$t('briefs.filters.label') as string">
        <button
          type="button"
          class="filter-chip"
          :class="{ active: activeSources.length === 0 }"
          @click="clearSourceFilter"
        >
          {{ $t("briefs.filters.all") as string }}
        </button>
        <button
          v-for="src in availableSources"
          :key="src"
          type="button"
          class="filter-chip"
          :class="{ active: activeSources.includes(src) }"
          @click="toggleSource(src)"
        >
          {{ $t(`briefs.source.${src}`) as string }}
        </button>
      </div>

      <div
        class="filter-bar"
        role="group"
        :aria-label="$t('briefs.filters.readinessLabel') as string"
      >
        <button
          type="button"
          class="filter-chip"
          :class="{ active: activeReadiness === '' }"
          @click="setReadiness('')"
        >
          {{ $t("briefs.filters.readinessAll") as string }}
        </button>
        <button
          type="button"
          class="filter-chip"
          :class="{ active: activeReadiness === 'ready' }"
          @click="setReadiness('ready')"
        >
          {{ $t("briefs.filters.readinessReady") as string }}
        </button>
        <button
          type="button"
          class="filter-chip"
          :class="{ active: activeReadiness === 'unready' }"
          @click="setReadiness('unready')"
        >
          {{ $t("briefs.filters.readinessUnready") as string }}
        </button>
        <button
          type="button"
          class="filter-chip filter-chip--plan-ready"
          :class="{ active: activeReadiness === 'plan_ready' }"
          @click="setReadiness('plan_ready')"
        >
          {{ $t("briefs.filters.readinessPlanReady") as string }}
        </button>
      </div>

      <BriefsSection
        :title="$t('briefs.sections.pending') as string"
        :description="$t('briefs.sections.pendingDescription') as string"
        :empty-title="$t('briefs.sections.pendingEmpty.title') as string"
        section-key="pending"
        :selectable="true"
        :briefs="pendingBriefs"
        :has-more="pendingHasMore"
        :loading="pendingLoading"
        :selected-ids="selectedBriefIds"
        @toggle-select="onToggleSelect"
        @select="onSelectBrief"
        @load-more="loadMorePending"
      />

      <BriefsSection
        :title="$t('briefs.sections.inFlight') as string"
        :description="$t('briefs.sections.inFlightDescription') as string"
        :empty-title="$t('briefs.sections.inFlightEmpty.title') as string"
        section-key="in-flight"
        :selectable="false"
        :briefs="inFlightBriefs"
        :has-more="inFlightHasMore"
        :loading="inFlightLoading"
        :selected-ids="[]"
        @select="onSelectBrief"
        @load-more="loadMoreInFlight"
      />

      <BriefsSection
        :title="$t('briefs.sections.done') as string"
        :description="$t('briefs.sections.doneDescription') as string"
        :empty-title="$t('briefs.sections.doneEmpty.title') as string"
        section-key="done"
        :selectable="false"
        :collapsed="true"
        :briefs="doneBriefs"
        :has-more="doneHasMore"
        :loading="doneLoading"
        :selected-ids="[]"
        @select="onSelectBrief"
        @load-more="loadMoreDone"
      />

      <BulkSelectionBar
        :selected-count="effectiveSelectedCount"
        :total-in-filter="selectAllMatchingTotal"
        :select-all-matching="selectAllMatching"
        @clear="resetSelection"
        @select-all-matching="onSelectAllMatching"
      >
        <template #actions>
          <GlassButton variant="primary" size="sm" @click="showApproveModal = true">
            {{ $t("briefs.bulk.approveSelected") as string }}
          </GlassButton>
          <GlassButton variant="ghost" size="sm" @click="onBulkDismiss">
            {{ $t("briefs.bulk.dismissSelected") as string }}
          </GlassButton>
        </template>
      </BulkSelectionBar>

      <BulkApproveModal
        v-if="showApproveModal"
        v-model="showApproveModal"
        :selector="currentSelectorPayload"
        :processing="bulkProcessing"
        @confirm="onBulkApproveConfirm"
      />
    </aside>

    <main class="detail-pane">
      <router-view v-if="selectedBriefId" />
      <EmptyState
        v-else
        :title="$t('briefs.detail.empty') as string"
        :description="$t('briefs.detail.emptyDescription') as string"
      />
    </main>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useBriefsSection } from "src/composables/useBriefsSection";
import { apiPost } from "src/lib/api";
import BriefsSection from "src/pages/briefs/BriefsSection.vue";
import BulkSelectionBar from "src/components/ui/BulkSelectionBar.vue";
import BulkApproveModal from "src/components/briefs/BulkApproveModal.vue";
import type { BulkBriefSelectorPayload } from "src/components/briefs/BulkApproveModal.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import type { BriefListItem } from "src/types/ui";

export default defineComponent({
  name: "BriefsPage",

  components: { BriefsSection, BulkSelectionBar, BulkApproveModal, GlassButton, EmptyState },

  setup() {
    const pending = useBriefsSection("pending");
    const inFlight = useBriefsSection("in-flight");
    const done = useBriefsSection("done");
    return {
      pendingBriefs: pending.briefs,
      pendingHasMore: pending.hasMore,
      pendingLoading: pending.loading,
      loadMorePending: pending.loadMore,
      refetchPending: pending.refetch,
      inFlightBriefs: inFlight.briefs,
      inFlightHasMore: inFlight.hasMore,
      inFlightLoading: inFlight.loading,
      loadMoreInFlight: inFlight.loadMore,
      doneBriefs: done.briefs,
      doneHasMore: done.hasMore,
      doneLoading: done.loading,
      loadMoreDone: done.loadMore,
    };
  },

  data: () => ({
    selectedBriefIds: [] as string[],
    bulkProcessing: false,
    showApproveModal: false,
    // Spec 64.17 — Mode-2 "Select all N matching filter" state. When true,
    // bulk actions submit the filter-shape body and the server re-queries at
    // action time; `selectedBriefIds` is ignored as the source of selection.
    selectAllMatching: false,
    // Server-reported total for the pending section under the active filter.
    // null = not yet probed (Mode-1 still selecting). Set by `probePendingTotal`
    // when the user has checkbox-selected every visible card AND more rows exist.
    selectAllMatchingTotal: null as number | null,
    // Mirrors topic_briefs.source enum (see packages/db/src/schema/content.ts).
    availableSources: [
      "gap_analysis",
      "trend_discovery",
      "refresh_detection",
      "comparison_discovery",
      "manual",
    ] as const,
  }),

  computed: {
    selectedBriefId(): string | null {
      const id = this.$route.params.briefId;
      return typeof id === "string" ? id : null;
    },
    activeSources(): string[] {
      const raw = this.$route.query.source;
      const csv = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
      if (typeof csv !== "string" || !csv) return [];
      return csv.split(",").map((s) => s.trim()).filter(Boolean);
    },
    activeReadiness(): "" | "ready" | "unready" | "plan_ready" {
      const raw = this.$route.query.readiness;
      const v = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
      return v === "ready" || v === "unready" || v === "plan_ready" ? v : "";
    },
    // Spec 64.17 — value the bar shows. In Mode-2 we show the server total
    // instead of the per-card array length (which would still equal the
    // visible page size, misleading the user).
    effectiveSelectedCount(): number {
      if (this.selectAllMatching && this.selectAllMatchingTotal !== null) {
        return this.selectAllMatchingTotal;
      }
      return this.selectedBriefIds.length;
    },
    // Spec 64.17 — selector body passed to both BulkApproveModal (preflight)
    // and the bulk-approve/dismiss POSTs. Mirrors the backend's
    // `bulkBriefSelectorSchema` discriminated union.
    currentSelectorPayload(): BulkBriefSelectorPayload {
      if (this.selectAllMatching) {
        const filter: {
          section: "pending";
          source?: string[];
          readiness?: "ready" | "unready" | "plan_ready" | "all";
        } = { section: "pending" };
        if (this.activeSources.length > 0) filter.source = [...this.activeSources];
        if (this.activeReadiness !== "") filter.readiness = this.activeReadiness;
        return { filter, excludeIds: [] };
      }
      return { briefIds: [...this.selectedBriefIds] };
    },
  },

  watch: {
    // Spec 64.17 — filter changes invalidate Mode-2 selection (the matching
    // set has shifted). Reset both to avoid carrying a stale Mode-2 across
    // filter chips.
    activeSources(): void {
      this.resetSelection();
    },
    activeReadiness(): void {
      this.resetSelection();
    },
    // When the user checkbox-selects every visible pending card AND the
    // server has more rows, probe the total so the banner can show "Select
    // all N matching filter →" with a real number. Skipped when Mode-2 is
    // already active or no probe is needed.
    selectedBriefIds: {
      handler(): void {
        void this.maybeProbePendingTotal();
      },
    },
    pendingBriefs: {
      handler(): void {
        void this.maybeProbePendingTotal();
      },
    },
  },

  methods: {
    writeSourceFilter(sources: string[]): void {
      const next = { ...this.$route.query };
      if (sources.length === 0) {
        delete next.source;
      } else {
        next.source = sources.join(",");
      }
      void this.$router.replace({ query: next });
    },
    toggleSource(src: string): void {
      const current = this.activeSources;
      const idx = current.indexOf(src);
      const next = idx === -1 ? [...current, src] : current.filter((s) => s !== src);
      this.writeSourceFilter(next);
    },
    clearSourceFilter(): void {
      this.writeSourceFilter([]);
    },
    setReadiness(value: "" | "ready" | "unready" | "plan_ready"): void {
      const next = { ...this.$route.query };
      if (!value) {
        delete next.readiness;
      } else {
        next.readiness = value;
      }
      void this.$router.replace({ query: next });
    },
    onToggleSelect(briefId: string): void {
      // Spec 64.17 — checkbox interaction in Mode-2 collapses back to a fresh
      // per-card selection containing only that brief. Cleaner than silently
      // keeping the filter selection or trying to do an inverse-deselect.
      if (this.selectAllMatching) {
        this.selectAllMatching = false;
        this.selectAllMatchingTotal = null;
        this.selectedBriefIds = [briefId];
        return;
      }
      const idx = this.selectedBriefIds.indexOf(briefId);
      if (idx === -1) {
        this.selectedBriefIds.push(briefId);
      } else {
        this.selectedBriefIds.splice(idx, 1);
      }
    },
    // Spec 64.17 — Mode-1 → Mode-2 promotion. The banner click hands us the
    // server-probed `selectAllMatchingTotal`; we just flip the mode flag and
    // clear the per-card array (it's no longer the source of selection).
    onSelectAllMatching(): void {
      if (this.selectAllMatchingTotal === null) return;
      this.selectAllMatching = true;
      this.selectedBriefIds = [];
    },
    // Spec 64.17 — clears every selection mode and probe state at once.
    resetSelection(): void {
      this.selectedBriefIds = [];
      this.selectAllMatching = false;
      this.selectAllMatchingTotal = null;
    },
    // Spec 64.17 — when every visible pending card is selected AND more rows
    // exist on the server, probe the bulk-preflight endpoint to learn the
    // actual filter-match total. We re-use the preflight (it returns
    // `totalMatched`) rather than introducing a separate count endpoint. The
    // request is throttled by short-circuiting once we have a value.
    async maybeProbePendingTotal(): Promise<void> {
      if (this.selectAllMatching) return;
      if (this.selectAllMatchingTotal !== null) return;
      const visible = this.pendingBriefs.length;
      if (visible === 0 || this.selectedBriefIds.length < visible) return;
      if (!this.pendingHasMore) return;

      const slug = this.$route.params.slug as string;
      try {
        const result = await apiPost<{ totalMatched: number }>(
          `/projects/${slug}/briefs/bulk-preflight-cluster-check`,
          this.buildFilterShapeSelector(),
        );
        // Only set if the server reports MORE than what's already selected —
        // otherwise the banner has nothing to offer.
        if (result.totalMatched > visible) {
          this.selectAllMatchingTotal = result.totalMatched;
        }
      } catch {
        // Soft fail — banner just stays hidden, Mode-1 still works.
      }
    },
    // Helper: builds the filter-shape selector for the pending section under
    // the current source + readiness filters. Mirrors `currentSelectorPayload`
    // when `selectAllMatching` is true but is callable BEFORE Mode-2 is
    // promoted (used by `maybeProbePendingTotal`).
    buildFilterShapeSelector(): BulkBriefSelectorPayload {
      const filter: {
        section: "pending";
        source?: string[];
        readiness?: "ready" | "unready" | "plan_ready" | "all";
      } = { section: "pending" };
      if (this.activeSources.length > 0) filter.source = [...this.activeSources];
      if (this.activeReadiness !== "") filter.readiness = this.activeReadiness;
      return { filter, excludeIds: [] };
    },
    onSelectBrief(brief: BriefListItem): void {
      const slug = this.$route.params.slug as string;
      void this.$router.push({
        path: `/projects/${slug}/briefs/${brief.id}`,
        query: this.$route.query,
      });
    },
    // Spec 64.14 Phase C: navigate to the manual brief creation form. Preserves
    // current filter state in the query so cancel/back lands on the same view.
    onOpenCreate(): void {
      const slug = this.$route.params.slug as string;
      void this.$router.push({
        path: `/projects/${slug}/briefs/new`,
        query: this.$route.query,
      });
    },
    async onBulkApproveConfirm(payload: {
      dispatch: "plan" | "immediate";
      mode: "assist" | "auto";
    }): Promise<void> {
      // Spec 64.17 — Mode-1 needs at least one ID; Mode-2 always proceeds with
      // the filter-shape selector (server may still resolve 0, that's fine).
      if (
        this.bulkProcessing ||
        (!this.selectAllMatching && this.selectedBriefIds.length === 0)
      ) {
        return;
      }
      this.bulkProcessing = true;
      try {
        const slug = this.$route.params.slug as string;
        const expectedSelectedCount = this.effectiveSelectedCount;
        const result = await apiPost<{
          dispatch: "plan" | "immediate";
          reQueried: boolean;
          totalMatched: number;
          total: number;
          approvedCount: number;
          planQueuedCount: number;
          skippedCount: number;
          failedCount: number;
        }>(`/projects/${slug}/briefs/bulk-approve`, {
          ...this.currentSelectorPayload,
          mode: payload.mode,
          dispatch: payload.dispatch,
        });
        this.showApproveModal = false;
        this.resetSelection();
        // Spec 63.6: 'plan' dispatch reports count under planQueuedCount, 'immediate'
        // under approvedCount — surface the correct success message per branch.
        const planQueued = result.planQueuedCount ?? 0;
        const approved = result.approvedCount ?? 0;
        const successKey =
          payload.dispatch === "plan"
            ? "briefs.bulkApprove.planSuccess"
            : "briefs.bulkApprove.immediateSuccess";
        this.$q.notify({
          type: "positive",
          message: this.$t(successKey, {
            count: payload.dispatch === "plan" ? planQueued : approved,
          }) as string,
        });
        // Spec 64.17 — race-condition diagnostic. When the filter-shape branch
        // resolved a different total than what we showed the user pre-submit,
        // surface a follow-up notify so the discrepancy isn't silent.
        if (
          result.reQueried &&
          expectedSelectedCount > 0 &&
          result.totalMatched !== expectedSelectedCount
        ) {
          this.$q.notify({
            type: "info",
            message: this.$t("briefs.bulk.raceDetected", { total: result.totalMatched }) as string,
            timeout: 6000,
          });
        }
        void this.refetchPending();
      } finally {
        this.bulkProcessing = false;
      }
    },
    async onBulkDismiss(): Promise<void> {
      if (
        this.bulkProcessing ||
        (!this.selectAllMatching && this.selectedBriefIds.length === 0)
      ) {
        return;
      }
      this.bulkProcessing = true;
      try {
        const slug = this.$route.params.slug as string;
        const expectedSelectedCount = this.effectiveSelectedCount;
        const result = await apiPost<{
          reQueried: boolean;
          totalMatched: number;
          requested: number;
          dismissed: number;
          skipped: number;
        }>(`/projects/${slug}/briefs/bulk-dismiss`, this.currentSelectorPayload);
        this.resetSelection();
        // Dismiss surfaces no per-count message by design — single-action
        // ceremony is lighter than approve (which carries plan/immediate
        // dispatch context). The race-banner below still fires when relevant.
        this.$q.notify({
          type: "info",
          message: this.$t("briefs.bulk.dismissSuccess") as string,
        });
        if (
          result.reQueried &&
          expectedSelectedCount > 0 &&
          result.totalMatched !== expectedSelectedCount
        ) {
          this.$q.notify({
            type: "info",
            message: this.$t("briefs.bulk.raceDetected", { total: result.totalMatched }) as string,
            timeout: 6000,
          });
        }
        void this.refetchPending();
      } finally {
        this.bulkProcessing = false;
      }
    },
  },
});
</script>

<style scoped>
.briefs-page {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.list-pane {
  width: 420px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-subtle);
  overflow-y: auto;
  padding: 16px;
  gap: 0;
  position: relative;
}

.page-header {
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 12px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border-subtle);
}

.filter-chip {
  font-size: 11px;
  line-height: 1;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-glass);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  padding: 5px 10px;
  cursor: pointer;
  transition: background-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              border-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .filter-chip:hover {
    color: var(--text-primary);
    border-color: var(--border-strong, var(--border-subtle));
  }
}

.filter-chip.active {
  color: var(--text-primary);
  background: var(--bg-elevated, var(--bg-glass));
  border-color: var(--accent, var(--text-primary));
}

.filter-chip:active {
  transform: scale(0.97);
}

@media (max-width: 767px) {
  /* WCAG / Apple HIG ≥ 44px tap target — see apps/web/CLAUDE.md */
  .filter-chip {
    min-height: 44px;
    padding: 12px 14px;
  }
}

.page-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.detail-pane {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}

@media (max-width: 767px) {
  .briefs-page {
    flex-direction: column;
  }

  .list-pane {
    width: 100%;
    max-height: 60vh;
  }
}
</style>
