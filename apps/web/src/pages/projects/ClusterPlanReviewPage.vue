<template>
  <q-page padding>
    <!-- Header -->
    <div class="row items-center q-mb-md">
      <q-btn
        flat
        dense
        icon="arrow_back"
        :label="$t('clusters.fullCluster.back') as string"
        no-caps
        @click="goBack"
      />
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="flex flex-center q-pa-xl">
      <div class="text-center">
        <q-spinner size="48px" color="primary" class="q-mb-md" />
        <div class="text-grey-7">{{ $t('clusters.create.loadingProposal') }}</div>
      </div>
    </div>

    <!-- Error state -->
    <q-banner v-else-if="loadError" rounded class="bg-negative text-white q-mb-md">
      <template #avatar><q-icon name="error" /></template>
      {{ loadError }}
    </q-banner>

    <template v-else-if="cluster">
      <!-- Cluster title + status -->
      <div class="text-h5 q-mb-xs">{{ cluster.name }}</div>
      <div class="text-caption text-grey-7 q-mb-md">{{ cluster.primaryKeyword }}</div>

      <!-- Hub article -->
      <div class="text-subtitle1 text-weight-medium q-mb-sm">{{ $t('clusters.fullCluster.hub') }}</div>
      <q-card flat bordered class="q-mb-md">
        <q-card-section>
          <div class="text-body1 text-weight-medium">{{ proposedHub.title }}</div>
          <div class="row q-gutter-sm q-mt-xs">
            <q-badge color="primary" outline>{{ proposedHub.intentType }}</q-badge>
            <q-badge color="grey-6" outline>{{ proposedHub.primaryKeyword }}</q-badge>
            <q-badge color="grey-5" outline>
              {{ $t('clusters.fullCluster.estimatedWords', { n: proposedHub.estimatedWordCount }) }}
            </q-badge>
          </div>
          <div v-if="proposedHub.h2Outline && proposedHub.h2Outline.length" class="q-mt-sm">
            <div class="text-caption text-grey-7 q-mb-xs">Outline:</div>
            <div
              v-for="(h2, i) in proposedHub.h2Outline"
              :key="i"
              class="text-caption text-grey-8 q-pl-sm"
            >
              {{ i + 1 }}. {{ h2 }}
            </div>
          </div>
        </q-card-section>
      </q-card>

      <!-- Spoke articles -->
      <div class="text-subtitle1 text-weight-medium q-mb-sm">
        {{ $t('clusters.fullCluster.spokes') }} ({{ proposedSpokes.length }})
      </div>
      <q-list separator bordered class="rounded-borders q-mb-md">
        <q-item v-for="(spoke, i) in proposedSpokes" :key="i">
          <q-item-section>
            <q-item-label class="text-weight-medium">{{ spoke.proposedTitle }}</q-item-label>
            <q-item-label caption class="q-mt-xs">
              <q-badge color="secondary" outline class="q-mr-xs">{{ spoke.intentType }}</q-badge>
              <span class="text-grey-7">{{ spoke.primaryKeyword }}</span>
              <span class="text-grey-5 q-ml-xs">·</span>
              <span class="text-grey-7 q-ml-xs">
                {{ $t('clusters.fullCluster.estimatedWords', { n: spoke.estimatedWordCount }) }}
              </span>
            </q-item-label>
            <q-item-label v-if="spoke.rationale" caption class="text-grey-6 q-mt-xs">
              {{ spoke.rationale }}
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-badge color="grey-4" text-color="grey-8">{{ i + 1 }}</q-badge>
          </q-item-section>
        </q-item>
      </q-list>

      <!-- API edit hint -->
      <q-banner class="bg-blue-1 text-blue-9 q-mb-md rounded-borders">
        <template #avatar><q-icon name="info" color="blue-7" /></template>
        <div>{{ $t('clusters.fullCluster.editViaApiHint') }}</div>
        <code class="text-caption">PATCH /api/projects/{{ slug }}/clusters/{{ id }}/plan/spokes/:index</code>
      </q-banner>

      <!-- Cost estimate -->
      <q-card v-if="costEstimate" flat bordered class="q-mb-md">
        <q-card-section>
          <div class="text-subtitle2 q-mb-sm">{{ $t('clusters.fullCluster.costTitle') }}</div>
          <div class="cost-grid">
            <span class="text-caption text-grey-7">{{ $t('clusters.fullCluster.costPlanLlm') }}</span>
            <span class="text-caption text-right">€{{ costEstimate.costBreakdown.clusterPlanLLM.toFixed(2) }}</span>

            <span class="text-caption text-grey-7">{{ $t('clusters.fullCluster.costHub') }}</span>
            <span class="text-caption text-right">€{{ costEstimate.costBreakdown.hubGeneration.toFixed(2) }}</span>

            <span class="text-caption text-grey-7">
              {{ $t('clusters.fullCluster.costSpokes', { n: proposedSpokes.length }) }}
            </span>
            <span class="text-caption text-right">€{{ costEstimate.costBreakdown.spokesGeneration.toFixed(2) }}</span>

            <span v-if="costEstimate.costBreakdown.translations > 0" class="text-caption text-grey-7">
              {{ $t('clusters.fullCluster.costTranslations', { n: costEstimate.articleCount }) }}
            </span>
            <span v-if="costEstimate.costBreakdown.translations > 0" class="text-caption text-right">
              €{{ costEstimate.costBreakdown.translations.toFixed(2) }}
            </span>
          </div>
          <q-separator class="q-my-sm" />
          <div class="row justify-between">
            <span class="text-body2 text-weight-medium">{{ $t('clusters.fullCluster.costTotal') }}</span>
            <span class="text-body2 text-weight-bold">€{{ costEstimate.totalEstimateEur.toFixed(2) }}</span>
          </div>
          <div class="text-caption text-grey-6 q-mt-xs">
            {{ $t('clusters.fullCluster.wallClock', {
              min: costEstimate.wallClockMinEstimate,
              max: costEstimate.wallClockMaxEstimate,
            }) }}
          </div>
        </q-card-section>
      </q-card>

      <!-- Actions -->
      <div class="row q-gutter-sm">
        <q-btn
          unelevated
          no-caps
          color="primary"
          icon="rocket_launch"
          :label="$t('clusters.fullCluster.approveBtn') as string"
          :loading="approving"
          @click="onApprove"
        />
        <q-btn
          flat
          no-caps
          icon="refresh"
          :label="$t('clusters.fullCluster.regenerateBtn') as string"
          :loading="regenerating"
          @click="regenerateDialogOpen = true"
        />
      </div>
    </template>

    <!-- Regenerate dialog -->
    <q-dialog v-model="regenerateDialogOpen">
      <q-card style="min-width: 360px">
        <q-card-section>
          <div class="text-h6">{{ $t('clusters.fullCluster.regenerateDialogTitle') }}</div>
        </q-card-section>
        <q-card-section class="q-pt-none">
          <q-input
            v-model="refinementHint"
            outlined
            dense
            type="textarea"
            rows="3"
            :label="$t('clusters.fullCluster.regenerateHint') as string"
            :placeholder="$t('clusters.fullCluster.regenerateHintPlaceholder') as string"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps :label="$t('clusters.fullCluster.regenerateCancel') as string" v-close-popup />
          <q-btn
            unelevated
            no-caps
            color="primary"
            :label="$t('clusters.fullCluster.regenerateConfirm') as string"
            :loading="regenerating"
            @click="onRegenerate"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuasar } from "quasar";
import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";

interface ProposedHub {
  title: string;
  primaryKeyword: string;
  intentType: string;
  estimatedWordCount: number;
  h2Outline: string[];
}

interface ProposedSpoke {
  proposedTitle: string;
  primaryKeyword: string;
  intentType: string;
  estimatedWordCount: number;
  rationale: string;
  position: number;
}

interface ClusterRow {
  id: string;
  name: string;
  primaryKeyword: string;
  generationStatus: string;
}

interface CostBreakdown {
  clusterPlanLLM: number;
  hubGeneration: number;
  spokesGeneration: number;
  translations: number;
}

interface CostEstimate {
  articleCount: number;
  totalArticleCount: number;
  costBreakdown: CostBreakdown;
  totalEstimateEur: number;
  wallClockMinEstimate: number;
  wallClockMaxEstimate: number;
}

export default defineComponent({
  name: "ClusterPlanReviewPage",

  props: {
    slug: { type: String, required: true },
    id:   { type: String, required: true },
  },

  setup() {
    return { $q: useQuasar() };
  },

  data: () => ({
    loading: false,
    loadError: null as string | null,
    approving: false,
    regenerating: false,
    regenerateDialogOpen: false,
    refinementHint: "" as string,
    cluster: null as ClusterRow | null,
    proposedHub: {} as ProposedHub,
    proposedSpokes: [] as ProposedSpoke[],
    costEstimate: null as CostEstimate | null,
  }),

  created() {
    void this.loadPlan();
  },

  methods: {
    goBack(): void {
      void this.$router.push({
        name: "project-trends",
        params: { slug: this.slug },
      });
    },

    async loadPlan(): Promise<void> {
      this.loading = true;
      this.loadError = null;
      try {
        const [planRes, costRes] = await Promise.all([
          api.get<{ ok: boolean; data: {
            clusterId: string;
            name: string;
            primaryKeyword: string;
            generationStatus: string;
            hub: ProposedHub;
            spokes: ProposedSpoke[];
          } }>(`/projects/${this.slug}/clusters/${this.id}/plan`),
          api.get<{ ok: boolean; data: CostEstimate }>(
            `/projects/${this.slug}/clusters/${this.id}/plan/cost-estimate`,
          ),
        ]);
        const d = planRes.data.data;
        this.cluster = {
          id: d.clusterId,
          name: d.name,
          primaryKeyword: d.primaryKeyword,
          generationStatus: d.generationStatus,
        };
        this.proposedHub = d.hub;
        this.proposedSpokes = d.spokes;
        this.costEstimate = costRes.data.data;
      } catch (e) {
        this.loadError = e instanceof HttpError
          ? e.userMessage
          : this.$t("clusters.fullCluster.loadFailed") as string;
      } finally {
        this.loading = false;
      }
    },

    async onApprove(): Promise<void> {
      this.approving = true;
      try {
        await api.post(
          `/projects/${this.slug}/clusters/${this.id}/plan/approve`,
        );
        this.$q.notify({
          type: "positive",
          message: this.$t("clusters.fullCluster.approveSuccess") as string,
        });
        void this.$router.push({
          name: "project-trends",
          params: { slug: this.slug },
        });
      } catch (e) {
        const msg = e instanceof HttpError
          ? e.userMessage
          : this.$t("clusters.fullCluster.approveFailed") as string;
        this.$q.notify({ type: "negative", message: msg });
      } finally {
        this.approving = false;
      }
    },

    async onRegenerate(): Promise<void> {
      this.regenerating = true;
      try {
        const body: Record<string, string> = {};
        if (this.refinementHint.trim()) {
          body["refinementHint"] = this.refinementHint.trim();
        }
        const res = await api.post<{ ok: boolean; data: {
          hub: ProposedHub;
          spokes: ProposedSpoke[];
        } }>(
          `/projects/${this.slug}/clusters/${this.id}/plan/regenerate`,
          body,
        );
        this.proposedHub = res.data.data.hub;
        this.proposedSpokes = res.data.data.spokes;
        this.regenerateDialogOpen = false;
        this.refinementHint = "";
        this.$q.notify({
          type: "positive",
          message: this.$t("clusters.fullCluster.regenerateSuccess") as string,
        });
        const costRes = await api.get<{ ok: boolean; data: CostEstimate }>(
          `/projects/${this.slug}/clusters/${this.id}/plan/cost-estimate`,
        );
        this.costEstimate = costRes.data.data;
      } catch (e) {
        const msg = e instanceof HttpError
          ? e.userMessage
          : this.$t("clusters.fullCluster.regenerateFailed") as string;
        this.$q.notify({ type: "negative", message: msg });
      } finally {
        this.regenerating = false;
      }
    },
  },
});
</script>

<style scoped>
.cost-grid {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 16px;
  align-items: baseline;
}
</style>
