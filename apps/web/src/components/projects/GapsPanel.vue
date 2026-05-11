<template>
  <div class="gaps-panel">
    <!-- Header toolbar -->
    <div class="row items-center justify-between q-mb-md">
      <div class="col">
        <span class="text-caption text-grey-6">
          <template v-if="gapsLastDetectedAt">
            {{ $t('gaps.lastDetected') }}
            {{ formatDate(gapsLastDetectedAt) }}
          </template>
          <template v-else>
            {{ $t('gaps.neverDetected') }}
          </template>
        </span>
        <span v-if="totalOpen > 0" class="q-ml-sm text-caption text-primary">
          · {{ $t('gaps.totalOpen', { count: totalOpen }) }}
        </span>
      </div>
      <q-btn
        color="primary"
        icon="search"
        :label="detecting ? $t('gaps.actions.running') : $t('gaps.actions.runDetection')"
        :loading="detecting"
        unelevated
        @click="runDetection"
      />
    </div>

    <!-- Filter chips -->
    <div class="row q-gutter-xs q-mb-sm">
      <q-chip
        v-for="f in filterOptions"
        :key="f.value"
        :selected="activeFilter === f.value"
        clickable
        :color="activeFilter === f.value ? 'primary' : 'grey-3'"
        :text-color="activeFilter === f.value ? 'white' : 'grey-8'"
        dense
        @click="setFilter(f.value)"
      >
        {{ $t(f.labelKey) as string }}
      </q-chip>
    </div>

    <!-- Batch action toolbar (visible when gaps exist) -->
    <div v-if="filteredGaps.length > 0" class="row q-gutter-sm q-mb-md">
      <q-btn
        flat
        dense
        size="sm"
        icon="close"
        color="grey-7"
        :label="$t('gaps.actions.dismissAll') as string"
        @click="batchDismiss"
      />
      <q-btn
        flat
        dense
        size="sm"
        icon="lightbulb"
        color="amber-8"
        :label="$t('gaps.actions.suggestAll') as string"
        :loading="batchSuggesting"
        @click="batchSuggest"
      />
    </div>

    <!-- Loading state -->
    <div v-if="loading && gaps.length === 0" class="text-center q-pa-xl">
      <q-spinner size="3em" color="primary" />
    </div>

    <!-- Empty state -->
    <div v-else-if="filteredGaps.length === 0" class="empty-state text-center q-pa-xl">
      <q-icon name="task_alt" size="64px" color="grey-4" />
      <p class="text-body1 q-mt-md text-grey-6">
        {{ activeFilter === 'all' ? $t('gaps.emptyState') : $t('gaps.emptyFiltered') }}
      </p>
      <p v-if="activeFilter === 'all' && !gapsLastDetectedAt" class="text-caption text-grey-5">
        {{ $t('gaps.emptyStateHint') }}
      </p>
    </div>

    <!-- Gap list -->
    <div v-else class="gap-list q-gutter-sm">
      <q-card
        v-for="gap in filteredGaps"
        :key="gap.id"
        flat
        bordered
        class="gap-card"
      >
        <q-card-section class="q-py-sm">
          <div class="row items-start no-wrap">
            <!-- Priority dot -->
            <q-icon
              name="fiber_manual_record"
              :color="priorityColor(gap.priority)"
              size="10px"
              class="q-mt-xs q-mr-sm"
            >
              <q-tooltip>{{ $t(`gaps.priority.${gap.priority}`) as string }}</q-tooltip>
            </q-icon>

            <div class="col">
              <!-- Type badge + cluster name + status chip -->
              <div class="row items-center q-gutter-xs q-mb-xs">
                <q-chip
                  dense
                  square
                  :color="gapTypeColor(gap.gapType)"
                  text-color="white"
                  class="q-px-xs text-caption"
                  style="height: 20px; font-size: 11px;"
                >
                  {{ $t(`gaps.gapType.${gap.gapType}`) as string }}
                </q-chip>
                <q-chip
                  v-if="gap.status !== 'open'"
                  dense
                  square
                  :color="statusColor(gap.status)"
                  text-color="white"
                  class="q-px-xs text-caption"
                  style="height: 20px; font-size: 11px;"
                >
                  {{ $t(`gaps.status.${gap.status}`) as string }}
                </q-chip>
                <span v-if="gap.metadata?.clusterName" class="text-body2 text-weight-medium">
                  {{ gap.metadata.clusterName }}
                </span>
              </div>

              <!-- Gap-type-specific detail line -->
              <div class="text-caption text-grey-7 row q-gutter-x-md q-mb-xs">
                <template v-if="gap.gapType === 'missing_translation'">
                  <span>
                    {{ $t('gaps.metadata.missingLocale') }}:
                    <strong>{{ gap.locale?.toUpperCase() }}</strong>
                  </span>
                  <span v-if="gap.metadata?.existingLocale">
                    {{ $t('gaps.metadata.locale') }}:
                    {{ gap.metadata.existingLocale.toUpperCase() }}
                  </span>
                  <span v-if="gap.metadata?.existingArticleSlug">
                    {{ $t('gaps.metadata.existingArticle') }}:
                    <code class="text-caption">{{ gap.metadata.existingArticleSlug }}</code>
                  </span>
                </template>
                <template v-else-if="gap.gapType === 'missing_spoke_type'">
                  <span>
                    {{ $t('gaps.metadata.intentType') }}:
                    <strong>{{ gap.intentType }}</strong>
                  </span>
                  <span v-if="gap.metadata?.spokesPresent?.length">
                    {{ $t('gaps.metadata.spokesPresent') }}:
                    {{ gap.metadata.spokesPresent.join(', ') }}
                  </span>
                </template>
                <template v-else>
                  <span v-if="gap.metadata?.clusterMemberCount !== undefined">
                    {{ $t('gaps.articleCount', { count: gap.metadata.clusterMemberCount }) }}
                  </span>
                </template>
              </div>

              <!-- LLM suggestion block (shown when metadata has suggestion) -->
              <div
                v-if="gap.metadata?.suggestedTitle"
                class="suggestion-block q-pa-xs q-mb-xs rounded-borders bg-amber-1"
              >
                <div class="text-caption text-amber-9 text-weight-medium q-mb-xs">
                  {{ $t('gaps.suggestion.title') }}
                  <em>{{ gap.metadata.suggestedTitle }}</em>
                </div>
                <div class="text-caption text-grey-7">
                  <code>{{ gap.metadata.suggestedSlug }}</code>
                </div>
                <div v-if="gap.metadata.suggestedMetaDescription" class="text-caption text-grey-6 q-mt-xs">
                  {{ gap.metadata.suggestedMetaDescription }}
                </div>
              </div>

              <!-- Links to created article/spec (in_progress state) -->
              <div v-if="gap.filledByArticleId || gap.filledBySpecId" class="row q-gutter-xs q-mt-xs">
                <q-btn
                  v-if="gap.filledByArticleId"
                  flat
                  dense
                  size="xs"
                  icon="article"
                  color="primary"
                  :label="$t('gaps.actions.viewArticle') as string"
                  :to="{ name: 'article-detail', params: { id: gap.filledByArticleId } }"
                />
                <q-btn
                  v-if="gap.filledBySpecId"
                  flat
                  dense
                  size="xs"
                  icon="auto_awesome"
                  color="deep-orange"
                  :label="$t('gaps.actions.viewSpec') as string"
                  :to="{ name: 'cornerstone-approval', params: { slug } }"
                />
              </div>
            </div>

            <!-- Action buttons column -->
            <div class="column q-gutter-xs q-ml-sm" style="min-width: 32px;">
              <!-- Suggest button -->
              <q-btn
                v-if="gap.status === 'open' || gap.status === 'in_progress'"
                flat
                round
                dense
                size="sm"
                :icon="gap.metadata?.suggestedTitle ? 'check_circle' : 'lightbulb_outline'"
                :color="gap.metadata?.suggestedTitle ? 'positive' : 'amber-8'"
                :loading="suggestingIds.has(gap.id)"
                @click="suggestTitle(gap)"
              >
                <q-tooltip>
                  {{ gap.metadata?.suggestedTitle
                    ? $t('gaps.suggestion.title') + ' ' + gap.metadata.suggestedTitle
                    : $t('gaps.actions.suggest') }}
                </q-tooltip>
              </q-btn>

              <!-- Generate button -->
              <q-btn
                v-if="gap.status === 'open' || gap.status === 'in_progress'"
                flat
                round
                dense
                size="sm"
                icon="play_arrow"
                :color="gap.gapType === 'missing_translation' ? 'grey-4' : 'positive'"
                :disable="gap.gapType === 'missing_translation' || generatingIds.has(gap.id)"
                :loading="generatingIds.has(gap.id)"
                @click="generateGap(gap)"
              >
                <q-tooltip>
                  {{ gap.gapType === 'missing_translation'
                    ? $t('gaps.actions.translationDisabled')
                    : $t('gaps.actions.generate') }}
                </q-tooltip>
              </q-btn>

              <!-- Mark in-progress -->
              <q-btn
                v-if="gap.status === 'open'"
                flat
                round
                dense
                size="sm"
                icon="work"
                color="grey-6"
                @click="patchGap(gap.id, 'in_progress')"
              >
                <q-tooltip>{{ $t('gaps.actions.markInProgress') as string }}</q-tooltip>
              </q-btn>

              <!-- Dismiss -->
              <q-btn
                v-if="gap.status !== 'dismissed'"
                flat
                round
                dense
                size="sm"
                icon="close"
                color="grey-5"
                @click="patchGap(gap.id, 'dismissed')"
              >
                <q-tooltip>{{ $t('gaps.actions.dismiss') as string }}</q-tooltip>
              </q-btn>
            </div>
          </div>
        </q-card-section>
      </q-card>
    </div>

    <!-- Load more -->
    <div v-if="hasMore" class="text-center q-mt-md">
      <q-btn
        flat
        color="primary"
        :label="$t('common.loadMore') as string"
        :loading="loading"
        @click="loadMore"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { useNotify } from "src/composables/useNotify";
import { HttpError } from "src/lib/http-error";
import { api } from "src/lib/api-client";
import { defineComponent } from "vue";

type GapType    = "missing_hub" | "missing_translation" | "missing_spoke_type" | "cluster_too_small";
type GapStatus  = "open" | "in_progress" | "resolved" | "dismissed";
type FilterValue = "all" | GapType;

interface GapMetadata {
  clusterName?: string;
  clusterMemberCount?: number;
  existingLocale?: string;
  existingArticleSlug?: string;
  spokesPresent?: string[];
  suggestedTitle?: string;
  suggestedSlug?: string;
  suggestedCornerstoneKeyword?: string;
  suggestedMetaDescription?: string;
  suggestedHeroImagePrompt?: string;
}

interface ContentGap {
  id:                  string;
  clusterId:           string | null;
  gapType:             GapType;
  locale:              string | null;
  intentType:          string | null;
  translationKey:      string | null;
  priority:            number;
  status:              GapStatus;
  metadata:            GapMetadata;
  filledByArticleId:   string | null;
  filledBySpecId:      string | null;
  detectedAt:          string;
  createdAt:           string;
}

const GAP_TYPE_COLORS: Record<GapType, string> = {
  missing_hub:         "deep-orange",
  missing_translation: "blue",
  missing_spoke_type:  "purple",
  cluster_too_small:   "grey-7",
};

const PRIORITY_COLORS: Record<number, string> = {
  1: "negative",
  2: "warning",
  3: "positive",
};

const STATUS_COLORS: Record<GapStatus, string> = {
  open:        "grey-5",
  in_progress: "blue",
  resolved:    "positive",
  dismissed:   "grey-4",
};

export default defineComponent({
  name: "GapsPanel",

  props: {
    slug: { type: String, required: true },
  },

  setup() {
    return { notify: useNotify() };
  },

  data: () => ({
    gaps:               [] as ContentGap[],
    gapsLastDetectedAt: null as string | null,
    totalOpen:          0,
    loading:            false,
    detecting:          false,
    batchSuggesting:    false,
    activeFilter:       "all" as FilterValue,
    offset:             0,
    limit:              50,
    hasMore:            false,
    suggestingIds:      new Set<string>(),
    generatingIds:      new Set<string>(),

    filterOptions: [
      { value: "all" as FilterValue,                 labelKey: "gaps.filters.all" },
      { value: "missing_hub" as FilterValue,         labelKey: "gaps.filters.missing_hub" },
      { value: "missing_translation" as FilterValue, labelKey: "gaps.filters.missing_translation" },
      { value: "missing_spoke_type" as FilterValue,  labelKey: "gaps.filters.missing_spoke_type" },
      { value: "cluster_too_small" as FilterValue,   labelKey: "gaps.filters.cluster_too_small" },
    ],
  }),

  computed: {
    filteredGaps(): ContentGap[] {
      if (this.activeFilter === "all") return this.gaps;
      return this.gaps.filter((g) => g.gapType === this.activeFilter);
    },
  },

  async created() {
    await this.loadGaps();
  },

  methods: {
    async loadGaps(append = false): Promise<void> {
      this.loading = true;
      try {
        const params: Record<string, string | number> = {
          limit:  this.limit,
          offset: append ? this.offset : 0,
        };

        const res = await api.get<{
          ok: boolean;
          data: {
            items: ContentGap[];
            total: number;
            limit: number;
            offset: number;
            gapsLastDetectedAt: string | null;
          };
        }>(`/projects/${this.slug}/content-gaps`, { params });

        const { items, total, gapsLastDetectedAt } = res.data.data;

        if (append) {
          this.gaps.push(...items);
        } else {
          this.gaps   = items;
          this.offset = 0;
        }

        this.offset             = this.gaps.length;
        this.totalOpen          = total;
        this.gapsLastDetectedAt = gapsLastDetectedAt;
        this.hasMore            = this.gaps.length < total;
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.loading = false;
      }
    },

    async loadMore(): Promise<void> {
      await this.loadGaps(true);
    },

    async runDetection(): Promise<void> {
      this.detecting = true;
      try {
        await api.post(`/projects/${this.slug}/detect-gaps`);
        await this.loadGaps();
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.detecting = false;
      }
    },

    async suggestTitle(gap: ContentGap): Promise<void> {
      this.suggestingIds = new Set([...this.suggestingIds, gap.id]);
      try {
        const res = await api.post<{
          ok: boolean;
          data: {
            title: string;
            slug: string;
            metaDescription: string;
            heroImagePrompt: string;
          };
        }>(`/projects/${this.slug}/content-gaps/${gap.id}/suggest`);

        const suggestion = res.data.data;
        // Update the gap in-place
        const idx = this.gaps.findIndex((g) => g.id === gap.id);
        if (idx !== -1) {
          this.gaps[idx] = {
            ...this.gaps[idx]!,
            metadata: {
              ...(this.gaps[idx]?.metadata ?? {}),
              suggestedTitle:           suggestion.title,
              suggestedSlug:            suggestion.slug,
              suggestedMetaDescription: suggestion.metaDescription,
              suggestedHeroImagePrompt: suggestion.heroImagePrompt,
            },
          };
        }
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        const next = new Set(this.suggestingIds);
        next.delete(gap.id);
        this.suggestingIds = next;
      }
    },

    async generateGap(gap: ContentGap): Promise<void> {
      if (gap.gapType === "missing_translation") return;
      this.generatingIds = new Set([...this.generatingIds, gap.id]);
      try {
        const res = await api.post<{
          ok: boolean;
          data: {
            type: "cornerstone_spec" | "article";
            cornerstoneSpecId?: string;
            articleId?: string;
            gapStatus: string;
          };
        }>(`/projects/${this.slug}/content-gaps/${gap.id}/generate`);

        // Update gap status in-place
        const idx = this.gaps.findIndex((g) => g.id === gap.id);
        if (idx !== -1) {
          const d = res.data.data;
          this.gaps[idx] = {
            ...this.gaps[idx]!,
            status:           "in_progress",
            filledByArticleId: d.articleId ?? this.gaps[idx]?.filledByArticleId ?? null,
            filledBySpecId:    d.cornerstoneSpecId ?? this.gaps[idx]?.filledBySpecId ?? null,
          };
        }
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        const next = new Set(this.generatingIds);
        next.delete(gap.id);
        this.generatingIds = next;
      }
    },

    async patchGap(gapId: string, newStatus: GapStatus): Promise<void> {
      try {
        await api.patch(`/projects/${this.slug}/content-gaps/${gapId}`, { status: newStatus });
        this.gaps = this.gaps.filter((g) => g.id !== gapId);
        this.totalOpen = Math.max(0, this.totalOpen - 1);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    async batchDismiss(): Promise<void> {
      const filter =
        this.activeFilter === "all" ? undefined : { gapType: this.activeFilter as GapType };
      try {
        const res = await api.post<{ ok: boolean; data: { affected: number } }>(
          `/projects/${this.slug}/content-gaps/batch`,
          { action: "dismiss", filters: filter }
        );
        const { affected } = res.data.data;
        await this.loadGaps();
        this.notify.success(this.$t('gaps.batch.dismissedSuccess', { count: affected }) as string);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    async batchSuggest(): Promise<void> {
      const filter =
        this.activeFilter === "all" ? undefined : { gapType: this.activeFilter as GapType };
      this.batchSuggesting = true;
      try {
        const res = await api.post<{ ok: boolean; data: { affected: number } }>(
          `/projects/${this.slug}/content-gaps/batch`,
          { action: "suggest-all", filters: filter }
        );
        const { affected } = res.data.data;
        await this.loadGaps();
        this.notify.success(this.$t('gaps.batch.suggestedSuccess', { count: affected }) as string);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.batchSuggesting = false;
      }
    },

    setFilter(value: FilterValue): void {
      this.activeFilter = value;
    },

    gapTypeColor(type: GapType): string {
      return GAP_TYPE_COLORS[type] ?? "grey";
    },

    priorityColor(priority: number): string {
      return PRIORITY_COLORS[priority] ?? "grey";
    },

    statusColor(status: GapStatus): string {
      return STATUS_COLORS[status] ?? "grey";
    },

    formatDate(iso: string): string {
      return new Date(iso).toLocaleString(
        this.$i18n.locale === "de" ? "de-DE" : "en-US",
        { dateStyle: "short", timeStyle: "short" }
      );
    },
  },
});
</script>

<style scoped>
.gap-card {
  transition: box-shadow 0.15s;
}
.gap-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.suggestion-block {
  border-left: 3px solid #f59e0b;
}
.empty-state {
  color: var(--q-color-grey-6);
}
</style>
