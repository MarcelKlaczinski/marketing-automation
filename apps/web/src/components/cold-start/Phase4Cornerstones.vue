<template>
  <div class="q-pt-md">
    <!-- loading initial data -->
    <div v-if="loadingInitial" class="text-center q-pa-md">
      <q-spinner size="2em" color="primary" />
    </div>

    <!-- no cluster data yet -->
    <div v-else-if="approvedClusters.length === 0 && phase === 'idle'">
      <q-banner class="bg-warning text-white" rounded>
        <template #avatar><q-icon name="warning" /></template>
        {{ $t('coldStart.phase4.noClusters') }}
      </q-banner>
    </div>

    <!-- idle with cluster data -->
    <div v-else-if="phase === 'idle'">
      <p class="text-body2 q-mb-md">
        {{ $t('coldStart.phase4.idleDescriptionMultiLang', { count: approvedClusters.length }) }}
      </p>

      <q-card flat bordered class="q-pa-md q-mb-md">
        <div class="text-subtitle2 q-mb-sm">{{ $t('coldStart.phase4.localesLabel') }}</div>
        <q-option-group
          v-model="selectedLocales"
          :options="localeOptions"
          type="checkbox"
          inline
        />
      </q-card>

      <q-btn
        color="primary"
        :label="$t('coldStart.phase4.generate')"
        :loading="triggering"
        :disable="selectedLocales.length === 0"
        unelevated
        @click="onGenerate"
      />
    </div>

    <!-- running -->
    <div v-else-if="phase === 'running'">
      <q-banner class="bg-blue-1 text-blue-9 q-mb-md" rounded>
        <template #avatar><q-spinner size="20px" color="primary" /></template>
        {{ $t('coldStart.phase4.running') }}
      </q-banner>
    </div>

    <!-- review pairs -->
    <template v-else-if="phase === 'review'">
      <p class="text-body2 q-mb-md">{{ $t('coldStart.phase4.reviewIntroMultiLang') }}</p>

      <CornerstonePairCard
        v-for="pair in pairs"
        :key="pair.translationKey"
        :pair="pair"
        :slug="slug"
        @approved="onPairChanged"
        @rejected="onPairChanged"
      />

      <div v-if="anyApproved" class="row q-mt-lg">
        <q-space />
        <q-btn
          color="positive"
          :label="$t('coldStart.phase4.generateArticles', { count: approvedClusterIds.length })"
          :loading="generating"
          unelevated
          @click="onGenerateArticles"
        />
      </div>

      <div class="q-mt-md row items-center q-gutter-md">
        <q-btn
          flat
          color="primary"
          :label="$t('coldStart.phase4.regenerate')"
          size="sm"
          :loading="triggering"
          @click="onGenerate"
        />
        <router-link
          :to="{ name: 'cornerstone-approval', params: { slug } }"
          class="text-primary text-caption"
        >
          {{ $t('coldStart.phase4.openStandaloneView') }}
        </router-link>
      </div>
    </template>

    <q-banner v-if="errorMsg" class="bg-negative text-white q-mt-md" rounded>
      <template #avatar><q-icon name="error" /></template>
      {{ errorMsg }}
    </q-banner>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { Notify } from "quasar";
import { usePipelineRunPolling } from "src/composables/usePipelineRunPolling";
import { api } from "src/lib/api-client";
import { useColdStartStore } from "src/stores/cold-start";
import CornerstonePairCard from "src/components/cornerstones/CornerstonePairCard.vue";
import type { CornerstonePair } from "src/components/cornerstones/types";

type Phase = "idle" | "running" | "review";
type Locale = "de" | "en";

export default defineComponent({
  name: "Phase4Cornerstones",

  components: { CornerstonePairCard },

  props: {
    slug: { type: String, required: true },
  },

  emits: ["done"],

  setup() {
    const runId = ref<string | null>(null);
    return {
      coldStartStore: useColdStartStore(),
      runId,
      polling: usePipelineRunPolling(runId),
    };
  },

  data: () => ({
    triggering: false,
    generating: false,
    loadingInitial: true,
    approvedClusters: [] as Array<{
      name: string;
      pillar: string;
      status: "approved";
      cornerstone_keyword: string;
      cornerstone_search_volume: number | null;
      cornerstone_difficulty: number | null;
      satellite_keywords: { keyword: string; search_volume: number | null; difficulty: number | null }[];
    }>,
    pairs: [] as CornerstonePair[],
    selectedLocales: ["de", "en"] as Locale[],
    errorMsg: "",
  }),

  computed: {
    localeOptions(): Array<{ label: string; value: Locale }> {
      return [
        { label: "Deutsch (DE)", value: "de" },
        { label: "English (EN)", value: "en" },
      ];
    },

    currentRun() {
      return this.polling.run.value;
    },

    phase(): Phase {
      const r = this.currentRun;
      if (r?.status === "running" || r?.status === "queued") return "running";
      if (this.pairs.length > 0) return "review";
      return "idle";
    },

    anyApproved(): boolean {
      return this.pairs.some(
        (p) => p.de?.status === "approved" || p.en?.status === "approved"
      );
    },

    approvedClusterIds(): string[] {
      const set = new Set<string>();
      for (const p of this.pairs) {
        if (p.de?.status === "approved" || p.en?.status === "approved") {
          set.add(p.clusterId);
        }
      }
      return Array.from(set);
    },
  },

  watch: {
    "polling.terminal.value"(isTerminal: boolean) {
      if (!isTerminal) return;
      const r = this.currentRun;
      if (r?.status === "completed") {
        void this.fetchPairs();
      } else if (r?.status === "failed") {
        this.errorMsg = r.error ?? (this.$t("coldStart.phase4.failed") as string);
      }
    },
  },

  async created() {
    await Promise.all([this.loadClusterData(), this.fetchPairs()]);
    this.loadingInitial = false;
  },

  methods: {
    async loadClusterData(): Promise<void> {
      try {
        const projectRes = await api.get<{ ok: boolean; data: { id: string } }>(
          `/projects/${this.slug}`
        );
        if (!projectRes.data.ok) return;
        const projectId = projectRes.data.data.id;

        interface ValidatedCluster {
          name: string;
          pillar: string;
          cornerstone_keyword: string;
          search_volume: number | null;
          keyword_difficulty: number | null;
        }

        const runsRes = await api.get<{
          ok: boolean;
          data: { output: { validated?: ValidatedCluster[] }; status: string }[];
        }>(
          `/pipeline-runs/project/${projectId}?pipelineNamePrefix=cold-start%3Acluster-propose&limit=5`
        );
        const runs = runsRes.data.data;
        const completedRun = runs.find((r) => r.status === "completed");
        if (completedRun?.output?.validated) {
          this.approvedClusters = completedRun.output.validated.map((c) => ({
            name: c.name,
            pillar: c.pillar,
            status: "approved" as const,
            cornerstone_keyword: c.cornerstone_keyword,
            cornerstone_search_volume: c.search_volume,
            cornerstone_difficulty: c.keyword_difficulty,
            satellite_keywords: [] as { keyword: string; search_volume: number | null; difficulty: number | null }[],
          }));
        }
      } catch {
        // non-fatal: user can still see existing pairs
      }
    },

    async fetchPairs(): Promise<void> {
      try {
        const res = await api.get<{
          ok: boolean;
          data: { pairs: CornerstonePair[]; totalSpecs: number };
        }>(`/projects/${this.slug}/cornerstone-specs`);
        this.pairs = res.data.data.pairs;
      } catch (e) {
        this.errorMsg = (e as Error).message;
      }
    },

    async onGenerate(): Promise<void> {
      if (this.approvedClusters.length === 0) return;
      this.triggering = true;
      this.errorMsg = "";
      try {
        const res = await api.post<{
          ok: boolean;
          data: { runId: string; jobId: string };
        }>(`/projects/${this.slug}/cold-start/cornerstones`, {
          approvedClusters: this.approvedClusters,
          locales: this.selectedLocales,
        });
        this.runId = res.data.data.runId;
      } catch {
        // shown by interceptor
      } finally {
        this.triggering = false;
      }
    },

    onPairChanged(): void {
      void this.fetchPairs();
    },

    async onGenerateArticles(): Promise<void> {
      this.generating = true;
      this.errorMsg = "";
      try {
        let totalEnqueued = 0;
        for (const clusterId of this.approvedClusterIds) {
          const res = await api.post<{
            ok: boolean;
            data: { results: Array<{ articleId: string; locale: string }> };
          }>(`/projects/${this.slug}/clusters/${clusterId}/generate-articles`);
          totalEnqueued += res.data.data.results.length;
        }
        Notify.create({
          type: "positive",
          message: this.$t("coldStart.phase4.articlesEnqueued", { total: totalEnqueued }) as string,
          timeout: 4000,
        });
        this.$emit("done");
      } catch (e) {
        this.errorMsg = (e as Error).message;
      } finally {
        this.generating = false;
      }
    },
  },
});
</script>
