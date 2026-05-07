<template>
  <div class="q-pt-md">
    <!-- loading initial data -->
    <div v-if="loadingClusters" class="text-center q-pa-md">
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
      <p class="text-body2 q-mb-md">{{ $t('coldStart.phase4.idleDescription') }}</p>
      <q-btn
        color="primary"
        :label="$t('coldStart.phase4.generate')"
        :loading="triggering"
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

    <!-- review cornerstones -->
    <template v-if="phase === 'review' || (phase === 'idle' && cornerstones.length > 0)">
      <p class="text-body2 q-mb-md">{{ $t('coldStart.phase4.reviewIntro') }}</p>

      <CornerstoneCard
        v-for="article in proposedCornerstones"
        :key="article.id"
        :article="article"
        :acting="actingOn === article.id"
        @approve="onApprove(article.id)"
        @reject="onReject(article.id)"
        @save="(patch) => onEdit(article.id, patch)"
      />

      <CornerstoneCard
        v-for="article in approvedCornerstones"
        :key="article.id"
        :article="article"
        :acting="actingOn === article.id"
        @approve="onApprove(article.id)"
        @reject="onReject(article.id)"
        @save="(patch) => onEdit(article.id, patch)"
      />

      <div v-if="approvedCornerstones.length > 0" class="row q-mt-lg">
        <q-space />
        <q-btn
          color="positive"
          :label="$t('coldStart.phase4.proceed', { count: approvedCornerstones.length })"
          unelevated
          @click="$emit('done')"
        />
      </div>

      <div class="q-mt-md">
        <q-btn flat color="primary" :label="$t('coldStart.phase4.generate')" size="sm" :loading="triggering" @click="onGenerate" />
      </div>
    </template>

    <q-banner v-if="errorMsg" class="bg-negative text-white q-mt-md" rounded>
      <template #avatar><q-icon name="error" /></template>
      {{ errorMsg }}
    </q-banner>
  </div>
</template>

<script lang="ts">
import { usePipelineRunPolling } from "src/composables/usePipelineRunPolling";
import { api } from "src/lib/api-client";
import { type CornerstoneArticle, useColdStartStore } from "src/stores/cold-start";
import { defineComponent, ref } from "vue";
import CornerstoneCard from "./CornerstoneCard.vue";

type Phase = "idle" | "running" | "review";

interface ValidatedCluster {
  name: string;
  pillar: string;
  cornerstone_keyword: string;
  search_volume: number | null;
  keyword_difficulty: number | null;
}

export default defineComponent({
  name: "Phase4Cornerstones",

  components: { CornerstoneCard },

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
    loadingClusters: true,
    approvedClusters: [] as {
      name: string;
      pillar: string;
      status: "approved";
      cornerstone_keyword: string;
      cornerstone_search_volume: number | null;
      cornerstone_difficulty: number | null;
      satellite_keywords: [];
    }[],
    actingOn: null as string | null,
    errorMsg: "",
  }),

  computed: {
    currentRun() {
      return this.polling.run.value;
    },

    cornerstones(): CornerstoneArticle[] {
      return this.coldStartStore.cornerstonesByProject[this.slug] ?? [];
    },

    proposedCornerstones(): CornerstoneArticle[] {
      return this.cornerstones.filter((a) => a.status === "proposed");
    },

    approvedCornerstones(): CornerstoneArticle[] {
      return this.cornerstones.filter((a) => a.status === "approved");
    },

    phase(): Phase {
      const r = this.currentRun;
      if (r?.status === "running" || r?.status === "queued") return "running";
      if (this.cornerstones.length > 0) return "review";
      return "idle";
    },
  },

  watch: {
    "polling.terminal.value"(isTerminal: boolean) {
      if (!isTerminal) return;
      const r = this.currentRun;
      if (r?.status === "completed") {
        void this.coldStartStore.fetchCornerstones(this.slug);
      } else if (r?.status === "failed") {
        this.errorMsg = r.error ?? (this.$t("coldStart.phase4.failed") as string);
      }
    },
  },

  async created() {
    await Promise.all([this.loadClusterData(), this.coldStartStore.fetchCornerstones(this.slug)]);
    this.loadingClusters = false;
  },

  methods: {
    async loadClusterData(): Promise<void> {
      try {
        // Find the project ID from the status endpoint data
        const statusRes = await api.get<{ ok: boolean; data: { clusters: { count: number } } }>(
          `/projects/${this.slug}/cold-start/status`
        );
        if (!statusRes.data.ok) return;

        // Fetch latest cluster-propose run output
        const projectRes = await api.get<{ ok: boolean; data: { id: string } }>(
          `/projects/${this.slug}`
        );
        if (!projectRes.data.ok) return;
        const projectId = projectRes.data.data.id;

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
            satellite_keywords: [] as [],
          }));
        }
      } catch {
        // non-fatal: user can still see existing cornerstones
      }
    },

    async onGenerate(): Promise<void> {
      if (this.approvedClusters.length === 0) return;
      this.triggering = true;
      this.errorMsg = "";
      try {
        const { runId } = await this.coldStartStore.triggerCornerstoneList(
          this.slug,
          this.approvedClusters
        );
        this.runId = runId;
      } catch {
        // shown by interceptor
      } finally {
        this.triggering = false;
      }
    },

    async onApprove(articleId: string): Promise<void> {
      this.actingOn = articleId;
      try {
        await this.coldStartStore.cornerstoneAction(this.slug, articleId, "approve");
        await this.coldStartStore.fetchCornerstones(this.slug);
      } finally {
        this.actingOn = null;
      }
    },

    async onReject(articleId: string): Promise<void> {
      this.actingOn = articleId;
      try {
        await this.coldStartStore.cornerstoneAction(this.slug, articleId, "reject");
        await this.coldStartStore.fetchCornerstones(this.slug);
      } finally {
        this.actingOn = null;
      }
    },

    async onEdit(
      articleId: string,
      patch: { title?: string; cornerstoneKeyword?: string; metaDescription?: string }
    ): Promise<void> {
      await this.coldStartStore.cornerstoneEdit(this.slug, articleId, patch);
      await this.coldStartStore.fetchCornerstones(this.slug);
    },
  },
});
</script>
