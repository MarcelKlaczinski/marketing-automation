<template>
  <div class="briefs-page">
    <aside class="list-pane">
      <div class="page-header">
        <h1 class="page-title">{{ $t("briefs.title") as string }}</h1>
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
        :selected-count="selectedBriefIds.length"
        @clear="selectedBriefIds = []"
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
        v-model="showApproveModal"
        :brief-ids="selectedBriefIds"
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
  }),

  computed: {
    selectedBriefId(): string | null {
      const id = this.$route.params.briefId;
      return typeof id === "string" ? id : null;
    },
  },

  methods: {
    onToggleSelect(briefId: string): void {
      const idx = this.selectedBriefIds.indexOf(briefId);
      if (idx === -1) {
        this.selectedBriefIds.push(briefId);
      } else {
        this.selectedBriefIds.splice(idx, 1);
      }
    },
    onSelectBrief(brief: BriefListItem): void {
      const slug = this.$route.params.slug as string;
      void this.$router.push(`/projects/${slug}/briefs/${brief.id}`);
    },
    async onBulkApproveConfirm({ mode }: { mode: "assist" | "auto" }): Promise<void> {
      if (!this.selectedBriefIds.length || this.bulkProcessing) return;
      this.bulkProcessing = true;
      try {
        const slug = this.$route.params.slug as string;
        const result = await apiPost<{
          total: number;
          approvedCount: number;
          skippedCount: number;
          failedCount: number;
        }>(`/projects/${slug}/briefs/bulk-approve`, {
          briefIds: this.selectedBriefIds,
          mode,
        });
        this.showApproveModal = false;
        this.selectedBriefIds = [];
        this.$q.notify({
          type: "positive",
          message: this.$t("briefs.bulk.approveSuccess", {
            count: result.approvedCount,
          }) as string,
        });
        void this.refetchPending();
      } finally {
        this.bulkProcessing = false;
      }
    },
    async onBulkDismiss(): Promise<void> {
      if (!this.selectedBriefIds.length || this.bulkProcessing) return;
      this.bulkProcessing = true;
      try {
        const slug = this.$route.params.slug as string;
        await apiPost(`/projects/${slug}/briefs/bulk-dismiss`, {
          briefIds: this.selectedBriefIds,
        });
        this.selectedBriefIds = [];
        this.$q.notify({
          type: "info",
          message: this.$t("briefs.bulk.dismissSuccess") as string,
        });
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
