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
        <GlassButton
          variant="ghost"
          size="sm"
          :loading="analyzing"
          :title="$t('refresh.analyzeAllHint') as string"
          @click="onAnalyzeAll"
        >
          {{ $t("refresh.analyzeAll") as string }}
        </GlassButton>
      </div>
    </header>

    <!-- ── Quality Suggestions section ─────────────────────────────── -->
    <section class="suggestions-section">
      <div class="section-header">
        <h2 class="section-title">{{ $t("refresh.suggestionsTitle") as string }}</h2>
        <p class="section-desc">{{ $t("refresh.suggestionsDescription") as string }}</p>
      </div>

      <LoadingShimmer v-if="suggestionsLoading" variant="card" :count="3" />

      <EmptyState
        v-else-if="!suggestions.length"
        :title="$t('refresh.empty.suggestions') as string"
        description=""
        compact
      />

      <div v-else class="suggestions-list stagger-list">
        <RefreshSuggestionCard
          v-for="s in suggestions"
          :key="s.id"
          class="stagger-item"
          :suggestion="s"
          :refreshing="refreshingArticleIds.includes(s.articleId)"
          :analyzing="analyzingArticleIds.includes(s.articleId)"
          @mark-refreshed="onMarkRefreshed"
          @dismiss="onDismissSuggestion"
          @view-findings="onViewFindings"
          @refresh="onRefreshSuggestion"
          @analyze-quality="onAnalyzeSingle"
        />
      </div>
    </section>

    <!-- ── Time-based candidates section ──────────────────────────── -->
    <section class="candidates-section">
      <div class="section-header">
        <h2 class="section-title">{{ $t("refresh.pageTitle") as string }}</h2>
      </div>

      <LoadingShimmer v-if="isLoading" variant="card" :count="5" />

      <EmptyState
        v-else-if="!candidates.length && !isLoading"
        :title="$t('refresh.empty.title') as string"
        :description="$t('refresh.empty.description') as string"
      />

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
    </section>

    <!-- Quality Findings Modal -->
    <QualityFindingsModal
      v-if="findingsModal.open && findingsModal.findings"
      v-model="findingsModal.open"
      :article-title="findingsModal.articleTitle"
      :recommendation="findingsModal.findings.overallRecommendation"
      :confidence="findingsModal.findings.confidence"
      :findings="findingsModal.findings"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useRefreshCandidates } from "src/composables/useRefreshCandidates";
import { useRefreshSuggestions, type RefreshSuggestion, type QualityFindings } from "src/composables/useRefreshSuggestions";
import { apiGet, apiPost } from "src/lib/api";
import { useProjectStore } from "src/stores/project";
import GlassButton from "src/components/ui/GlassButton.vue";
import EmptyState from "src/components/ui/EmptyState.vue";
import LoadingShimmer from "src/components/ui/LoadingShimmer.vue";
import RefreshCandidateCard from "src/components/refresh/RefreshCandidateCard.vue";
import RefreshSuggestionCard from "src/components/refresh/RefreshSuggestionCard.vue";
import QualityFindingsModal from "src/components/refresh/QualityFindingsModal.vue";

interface CronStatusResponse {
  active: boolean;
  lastRunAt: string | null;
  cronLastRunAt: string | null;
  manualLastDetectedAt: string | null;
}

interface AnalyzeAllResponse {
  enqueued: number;
  estimatedCostEur: number;
  jobIds: string[];
}

interface FindingsModalState {
  open: boolean;
  articleTitle: string;
  findings: QualityFindings | null;
}

export default defineComponent({
  name: "RefreshQueuePage",

  components: {
    GlassButton,
    EmptyState,
    LoadingShimmer,
    RefreshCandidateCard,
    RefreshSuggestionCard,
    QualityFindingsModal,
  },

  setup() {
    return {
      ...useRefreshCandidates(),
      ...useRefreshSuggestions(),
    };
  },

  data: () => ({
    detecting: false,
    analyzing: false,
    cronActive: false,
    cronLastRunAt: null as string | null,
    manualLastDetectedAt: null as string | null,
    refreshingArticleIds: [] as string[],
    analyzingArticleIds: [] as string[],
    findingsModal: {
      open: false,
      articleTitle: "",
      findings: null,
    } as FindingsModalState,
  }),

  computed: {
    slug(): string {
      return useProjectStore().currentSlug;
    },
    cronStatusClass(): string {
      return this.cronActive ? "cron-dot--active" : "cron-dot--idle";
    },
    cronLabel(): string {
      // Prefer manual-run timestamp when available — cron may be off but manual triggers ran.
      // Falls back to cron's last_run_at, then "never" if neither has fired.
      const ts = this.manualLastDetectedAt ?? this.cronLastRunAt;
      if (ts) {
        return this.$t("refresh.lastDetection", { time: this.relativeTime(ts) }) as string;
      }
      return this.$t("refresh.neverDetected") as string;
    },
    suggestionsLoading(): boolean {
      return (this as unknown as ReturnType<typeof useRefreshSuggestions>).isLoading.value;
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
        this.cronLastRunAt = data.cronLastRunAt;
        this.manualLastDetectedAt = data.manualLastDetectedAt;
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

    async onAnalyzeAll(): Promise<void> {
      this.analyzing = true;
      try {
        const result = await apiPost<AnalyzeAllResponse>(
          `/projects/${this.slug}/articles/quality-analysis`,
          {},
        );
        this.$q.notify({
          type: "positive",
          message: this.$t("refresh.analyzeStarted", { count: result.enqueued }) as string,
        });
      } catch {
        this.$q.notify({
          type: "negative",
          message: this.$t("refresh.analyzeFailed") as string,
        });
      } finally {
        this.analyzing = false;
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

    async onMarkRefreshed(articleId: string): Promise<void> {
      try {
        await this.markRefreshed(articleId);
        this.$q.notify({
          type: "positive",
          message: this.$t("refresh.markRefreshedSuccess") as string,
        });
      } catch {
        this.$q.notify({
          type: "negative",
          message: this.$t("refresh.markRefreshedFailed") as string,
        });
      }
    },

    async onRefreshSuggestion(articleId: string): Promise<void> {
      this.refreshingArticleIds.push(articleId);
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
      } finally {
        this.refreshingArticleIds = this.refreshingArticleIds.filter((id) => id !== articleId);
      }
    },

    async onAnalyzeSingle(articleId: string): Promise<void> {
      this.analyzingArticleIds.push(articleId);
      try {
        await apiPost<AnalyzeAllResponse>(
          `/projects/${this.slug}/articles/quality-analysis`,
          { articleIds: [articleId] },
        );
        this.$q.notify({
          type: "positive",
          message: this.$t("refresh.analyzeOneStarted") as string,
        });
      } catch {
        this.$q.notify({
          type: "negative",
          message: this.$t("refresh.analyzeOneFailed") as string,
        });
      } finally {
        this.analyzingArticleIds = this.analyzingArticleIds.filter((id) => id !== articleId);
      }
    },

    async onDismissSuggestion(id: string): Promise<void> {
      try {
        await this.dismissSuggestion(id);
        this.$q.notify({
          type: "positive",
          message: this.$t("refresh.suggestionDismissed") as string,
        });
      } catch {
        this.$q.notify({
          type: "negative",
          message: this.$t("refresh.dismissFailed") as string,
        });
      }
    },

    onViewFindings(suggestion: RefreshSuggestion): void {
      if (!suggestion.qualityFindings) return;
      this.findingsModal = {
        open: true,
        articleTitle: suggestion.articleTitle ?? suggestion.articleSlug,
        findings: suggestion.qualityFindings,
      };
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
  gap: 24px;
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
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
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

.suggestions-section,
.candidates-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.section-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
}

.suggestions-list,
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
