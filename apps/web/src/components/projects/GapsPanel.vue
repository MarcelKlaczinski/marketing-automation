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
    <div class="row q-gutter-xs q-mb-md">
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

    <!-- Loading skeleton -->
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
              <!-- Type badge + cluster name -->
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
                <span v-if="gap.metadata?.clusterName" class="text-body2 text-weight-medium">
                  {{ gap.metadata.clusterName }}
                </span>
              </div>

              <!-- Gap-type-specific detail line -->
              <div class="text-caption text-grey-7 q-gutter-x-md row">
                <!-- missing_translation -->
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

                <!-- missing_spoke_type -->
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

                <!-- missing_hub / cluster_too_small -->
                <template v-else>
                  <span v-if="gap.metadata?.clusterMemberCount !== undefined">
                    {{ gap.metadata.clusterMemberCount }} Artikel
                  </span>
                </template>
              </div>
            </div>

            <!-- Actions -->
            <div class="row q-gutter-xs q-ml-sm">
              <q-btn
                v-if="gap.status === 'open'"
                flat
                dense
                size="sm"
                icon="work"
                color="grey-6"
                @click="patchGap(gap.id, 'in_progress')"
              >
                <q-tooltip>{{ $t('gaps.actions.markInProgress') as string }}</q-tooltip>
              </q-btn>
              <q-btn
                v-if="gap.status !== 'dismissed'"
                flat
                dense
                size="sm"
                icon="close"
                color="grey-6"
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

type GapType = "missing_hub" | "missing_translation" | "missing_spoke_type" | "cluster_too_small";
type GapStatus = "open" | "in_progress" | "resolved" | "dismissed";

interface GapMetadata {
  clusterName?: string;
  clusterMemberCount?: number;
  existingLocale?: string;
  existingArticleSlug?: string;
  spokesPresent?: string[];
  suggestedTitle?: string;
}

interface ContentGap {
  id: string;
  clusterId: string | null;
  gapType: GapType;
  locale: string | null;
  intentType: string | null;
  translationKey: string | null;
  priority: number;
  status: GapStatus;
  metadata: GapMetadata;
  detectedAt: string;
  createdAt: string;
}

type FilterValue = "all" | GapType;

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

export default defineComponent({
  name: "GapsPanel",

  props: {
    slug: { type: String, required: true },
  },

  setup() {
    return { notify: useNotify() };
  },

  data: () => ({
    gaps:                [] as ContentGap[],
    gapsLastDetectedAt:  null as string | null,
    totalOpen:           0,
    loading:             false,
    detecting:           false,
    activeFilter:        "all" as FilterValue,
    offset:              0,
    limit:               50,
    hasMore:             false,

    filterOptions: [
      { value: "all" as FilterValue,                labelKey: "gaps.filters.all" },
      { value: "missing_hub" as FilterValue,        labelKey: "gaps.filters.missing_hub" },
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
          this.gaps = items;
          this.offset = 0;
        }

        this.offset              = this.gaps.length;
        this.totalOpen           = total;
        this.gapsLastDetectedAt  = gapsLastDetectedAt;
        this.hasMore             = this.gaps.length < total;
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
        await api.post<{ ok: boolean; data: { gapsCreated: number; gapsRestamped: number; gapsResolved: number; totalOpen: number } }>(
          `/projects/${this.slug}/detect-gaps`
        );
        await this.loadGaps();
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.detecting = false;
      }
    },

    async patchGap(gapId: string, newStatus: GapStatus): Promise<void> {
      try {
        await api.patch(`/projects/${this.slug}/content-gaps/${gapId}`, { status: newStatus });
        // Remove from local list (they move out of open/in_progress view)
        this.gaps = this.gaps.filter((g) => g.id !== gapId);
        this.totalOpen = Math.max(0, this.totalOpen - 1);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
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
.empty-state {
  color: var(--q-color-grey-6);
}
</style>
