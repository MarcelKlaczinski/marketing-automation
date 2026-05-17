<template>
  <div class="refresh-queue-page">
    <!-- Header -->
    <header class="page-header">
      <div class="header-info">
        <h1 class="page-title">{{ $t("refresh.pageTitle") as string }}</h1>
        <p class="page-desc">{{ $t("refresh.pageDescription") as string }}</p>
      </div>

      <div class="header-actions">
        <div class="cron-status">
          <span class="cron-dot" :class="cronStatusClass" />
          <span class="cron-label mono">{{ cronLabel }}</span>
        </div>
        <GlassButton
          variant="secondary"
          size="sm"
          :loading="detecting"
          @click="onRunDetection"
        >
          {{ $t("refresh.runDetection") as string }}
        </GlassButton>
      </div>
    </header>

    <!-- Loading -->
    <LoadingShimmer v-if="isLoading" variant="card" :count="5" />

    <!-- Empty -->
    <EmptyState
      v-else-if="!candidates.length && !isLoading"
      :title="$t('refresh.empty.title') as string"
      :description="$t('refresh.empty.description') as string"
    />

    <!-- List -->
    <div v-else class="candidates-list stagger-list">
      <RefreshCandidateCard
        v-for="candidate in candidates"
        :key="candidate.id"
        class="stagger-item"
        :candidate="candidate"
        @trigger="onTrigger(candidate.id)"
        @dismiss="onDismiss(candidate.id)"
      />
    </div>

    <!-- Load more -->
    <div v-if="hasMore" class="load-more">
      <GlassButton
        variant="ghost"
        size="sm"
        :loading="isFetchingMore"
        @click="loadMore()"
      >
        {{ $t("refresh.loadMore") as string }}
      </GlassButton>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useRefreshCandidates } from "src/composables/useRefreshCandidates";
import { apiGet, apiPost } from "src/lib/api";
import { useProjectStore } from "src/stores/project";
import GlassButton from "src/components/ui/GlassButton.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import RefreshCandidateCard from "src/components/refresh/RefreshCandidateCard.vue";

interface CronStatusResponse {
  active: boolean;
  lastRunAt: string | null;
}

export default defineComponent({
  name: "RefreshQueuePage",

  components: { GlassButton, EmptyState, LoadingShimmer, RefreshCandidateCard },

  setup() {
    return useRefreshCandidates();
  },

  data: () => ({
    detecting: false,
    cronActive: false,
    cronLastRunAt: null as string | null,
  }),

  computed: {
    slug(): string {
      return useProjectStore().currentSlug;
    },
    cronStatusClass(): string {
      return this.cronActive ? "cron-dot--active" : "cron-dot--idle";
    },
    cronLabel(): string {
      if (this.cronLastRunAt) {
        return this.$t("refresh.lastDetection", { time: this.relativeTime(this.cronLastRunAt) }) as string;
      }
      return this.$t("refresh.neverDetected") as string;
    },
  },

  mounted() {
    void this.loadCronStatus();
  },

  methods: {
    async loadCronStatus(): Promise<void> {
      try {
        const data = await apiGet<CronStatusResponse>(
          `/projects/${this.slug}/refresh-detection/status`,
        );
        this.cronActive = data.active;
        this.cronLastRunAt = data.lastRunAt;
      } catch {
        // non-critical
      }
    },

    async onRunDetection(): Promise<void> {
      this.detecting = true;
      try {
        await apiPost(`/projects/${this.slug}/refresh-detection/run`, {});
        this.$q.notify({
          type: "positive",
          message: this.$t("refresh.detectionStarted") as string,
        });
        void this.loadCronStatus();
      } catch {
        this.$q.notify({
          type: "negative",
          message: this.$t("refresh.detectionFailed") as string,
        });
      } finally {
        this.detecting = false;
      }
    },

    async onTrigger(articleId: string): Promise<void> {
      try {
        await this.triggerRefresh(articleId);
        this.$q.notify({
          type: "positive",
          message: this.$t("refresh.triggered") as string,
        });
      } catch {
        this.$q.notify({
          type: "negative",
          message: this.$t("refresh.triggerFailed") as string,
        });
      }
    },

    async onDismiss(articleId: string): Promise<void> {
      try {
        await this.dismissCandidate(articleId);
      } catch {
        this.$q.notify({
          type: "negative",
          message: this.$t("refresh.dismissFailed") as string,
        });
      }
    },

    relativeTime(iso: string): string {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60_000);
      if (mins < 2) return this.$t("forms.justNow") as string;
      if (mins < 60) return this.$t("forms.minutesAgo", { n: mins }, mins) as string;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return this.$t("forms.hoursAgo", { n: hrs }, hrs) as string;
      const days = Math.floor(hrs / 24);
      return this.$t("forms.daysAgo", { n: days }, days) as string;
    },
  },
});
</script>

<style scoped>
.refresh-queue-page {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 860px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.page-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.cron-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cron-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.cron-dot--active {
  background: #4ade80;
  box-shadow: 0 0 6px rgba(74, 222, 128, 0.6);
}

.cron-dot--idle {
  background: var(--text-tertiary);
}

.cron-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

.candidates-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.load-more {
  display: flex;
  justify-content: center;
  padding-top: 8px;
}

@media (max-width: 767px) {
  .refresh-queue-page {
    padding: 16px;
  }

  .page-header {
    flex-direction: column;
  }

  .header-actions {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
