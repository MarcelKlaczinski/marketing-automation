<template>
  <q-card flat bordered>
    <q-card-section class="row items-center q-py-sm">
      <div class="text-subtitle1 text-weight-medium">{{ $t('trends.tabs.pending') }}</div>
      <q-space />
      <q-chip dense outline color="primary">{{ briefs.length }} {{ $t('trends.briefs') }}</q-chip>
    </q-card-section>

    <q-separator />

    <div v-if="loading" class="q-pa-md text-center">
      <q-spinner color="primary" size="24px" />
    </div>

    <q-list v-else-if="briefs.length > 0" separator>
      <q-item
        v-for="b in briefs"
        :key="b.id"
        clickable
        :active="b.id === selectedId"
        active-class="bg-blue-1"
        @click="$emit('select', b)"
      >
        <q-item-section>
          <q-item-label lines="2" class="text-weight-medium">{{ b.topicTitle }}</q-item-label>
          <q-item-label caption class="q-mt-xs">
            <SignalSourceMixBadge :signals="(b.trendMetadata && b.trendMetadata.signals) ? b.trendMetadata.signals : []" />
          </q-item-label>
        </q-item-section>

        <q-item-section side top>
          <q-badge
            :color="scoreColor(b.trendMetadata && b.trendMetadata.trendScore ? b.trendMetadata.trendScore : 0)"
            class="q-mt-xs"
          >
            {{ b.trendMetadata && b.trendMetadata.trendScore != null ? b.trendMetadata.trendScore : '?' }}
          </q-badge>
          <q-badge
            v-if="b.trendMetadata && b.trendMetadata.freshnessWindow"
            :color="freshnessColor(b.trendMetadata.freshnessWindow)"
            outline
            class="q-mt-xs"
          >
            {{ $t(`trends.freshness.${b.trendMetadata.freshnessWindow}`) }}
          </q-badge>
        </q-item-section>
      </q-item>
    </q-list>

    <q-card-section v-else class="text-grey-6 text-center q-pa-xl">
      {{ $t('trends.noBriefsHint') }}
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";
import SignalSourceMixBadge from "./SignalSourceMixBadge.vue";

export interface TrendBriefRow {
  id: string;
  topicTitle: string;
  suggestedTitle: string | null;
  suggestedMeta: string | null;
  suggestedSlug: string | null;
  heroImagePrompt: string | null;
  intentType: string | null;
  generationMode: string | null;
  clusterAction: string;
  clusterId: string | null;
  approvalStatus: string;
  trendMetadata: {
    trendScore: number;
    freshnessWindow: "breaking" | "rising" | "stable";
    signals: Array<{ id?: string; source: string; externalId: string; url?: string; capturedAt: string }>;
    scoreBreakdown?: {
      communityBuzz: number;
      searchVolumeGrowth: number;
      officialAnnouncement: number;
      serpVolatility: number;
      existingCoveragePenalty: number;
    };
  } | null;
}

export default defineComponent({
  name: "TrendBriefList",

  components: { SignalSourceMixBadge },

  props: {
    projectSlug: { type: String, required: true },
    selectedId: { type: String, default: null },
    refreshKey: { type: Number, default: 0 },
  },

  emits: ["select"],

  data: () => ({
    briefs: [] as TrendBriefRow[],
    loading: false,
  }),

  watch: {
    refreshKey() {
      void this.fetchBriefs();
    },
    projectSlug() {
      void this.fetchBriefs();
    },
  },

  created() {
    void this.fetchBriefs();
  },

  methods: {
    async fetchBriefs(): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: { briefs: TrendBriefRow[] } }>(
          `/projects/${this.projectSlug}/trends/pending-briefs`,
        );
        this.briefs = res.data.data.briefs;
      } catch (e) {
        if (e instanceof HttpError) {
          console.error("Failed to load trend briefs", e.userMessage);
        }
        this.briefs = [];
      } finally {
        this.loading = false;
      }
    },

    scoreColor(score: number): string {
      if (score >= 70) return "positive";
      if (score >= 40) return "warning";
      return "negative";
    },

    freshnessColor(window: string): string {
      if (window === "breaking") return "red";
      if (window === "rising") return "orange";
      return "grey-6";
    },
  },
});
</script>
