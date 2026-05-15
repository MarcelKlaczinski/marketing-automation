<template>
  <q-page padding>
    <!-- Header row -->
    <div class="row items-center q-mb-md">
      <q-btn
        flat
        dense
        icon="arrow_back"
        :label="$t('clusters.create.back') as string"
        no-caps
        @click="goBack"
      />
      <q-space />
      <q-btn
        v-if="proposal && !loading"
        flat
        no-caps
        icon="refresh"
        :label="$t('clusters.create.regenerate') as string"
        :loading="loading"
        @click="loadProposal"
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

    <!-- No brief ID -->
    <q-banner v-else-if="!fromBriefId" rounded class="bg-warning q-mb-md">
      {{ $t('clusters.create.noBriefId') }}
    </q-banner>

    <!-- Stepper -->
    <q-stepper
      v-else-if="proposal"
      v-model="step"
      flat
      bordered
      animated
      header-nav
      color="primary"
    >
      <q-step :name="1" :title="$t('clusters.create.step1Title') as string" icon="hub" :done="step > 1">
        <ClusterShapeForm
          v-model="proposal"
          :project-default-intents="projectDefaultIntents"
        />
      </q-step>

      <q-step :name="2" :title="$t('clusters.create.step2Title') as string" icon="article" :done="step > 2">
        <PillarSpecForm v-model="proposal" />
      </q-step>

      <q-step :name="3" :title="$t('clusters.create.step3Title') as string" icon="task_alt">
        <ClusterCreateConfirm
          :proposal="proposal"
          :brief-title="briefTitle"
          :generate-mode="generateMode"
          :creating="creating"
          @update:generate-mode="generateMode = $event"
          @create="onCreate"
        />
      </q-step>

      <template #navigation>
        <q-stepper-navigation>
          <q-btn
            v-if="step < 3"
            unelevated
            no-caps
            color="primary"
            :label="$t('common.next') as string"
            @click="step++"
          />
          <q-btn
            v-if="step > 1"
            flat
            no-caps
            :label="$t('common.back') as string"
            class="q-ml-sm"
            @click="step--"
          />
        </q-stepper-navigation>
      </template>
    </q-stepper>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQuasar } from "quasar";
import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";
import ClusterShapeForm from "src/components/clusters/ClusterShapeForm.vue";
import PillarSpecForm from "src/components/clusters/PillarSpecForm.vue";
import ClusterCreateConfirm from "src/components/clusters/ClusterCreateConfirm.vue";

interface ClusterProposal {
  cluster_name: string;
  primary_keyword: string;
  description: string;
  intent_taxonomy_override: string[] | null;
  pillar_title: string;
  pillar_slug: string;
  pillar_meta: string;
  pillar_outline: string[];
  spoke_intent_for_originating_brief: string;
  reasoning: string;
}

export default defineComponent({
  name: "ClusterCreatorPage",

  components: { ClusterShapeForm, PillarSpecForm, ClusterCreateConfirm },

  props: {
    slug: { type: String, required: true },
  },

  setup() {
    return { $q: useQuasar() };
  },

  data: () => ({
    step: 1,
    loading: false,
    loadError: null as string | null,
    creating: false,
    proposal: null as ClusterProposal | null,
    fromBriefId: "" as string,
    briefTitle: "" as string,
    generateMode: "queue" as "queue" | "now",
    projectDefaultIntents: [] as string[],
  }),

  created() {
    const raw = this.$route.query["fromBrief"];
    this.fromBriefId = Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
    if (this.fromBriefId) {
      void this.loadProposal();
    }
  },

  methods: {
    goBack(): void {
      this.$router.push({ name: "project-trends", params: { slug: this.slug } });
    },

    async loadProposal(): Promise<void> {
      if (!this.fromBriefId) return;
      this.loading = true;
      this.loadError = null;
      try {
        const res = await api.post<{
          ok: boolean;
          data: { proposal: ClusterProposal; projectDefaultIntents: string[] };
        }>(
          `/projects/${this.slug}/clusters/propose`,
          { fromBriefId: this.fromBriefId },
        );
        this.proposal = res.data.data.proposal;
        this.projectDefaultIntents = res.data.data.projectDefaultIntents;
      } catch (err) {
        this.loadError = err instanceof HttpError ? err.userMessage : String(err);
      } finally {
        this.loading = false;
      }
    },

    async onCreate(): Promise<void> {
      if (!this.proposal) return;
      this.creating = true;
      try {
        const res = await api.post<{
          ok: boolean;
          data: { articleId: string | null; clusterId: string };
        }>(
          `/projects/${this.slug}/clusters/create-from-brief`,
          {
            fromBriefId: this.fromBriefId,
            proposal: this.proposal,
            generateMode: this.generateMode,
          },
        );

        this.$q.notify({
          type: "positive",
          message: this.$t(
            this.generateMode === "now"
              ? "clusters.create.successNow"
              : "clusters.create.successQueue",
          ) as string,
        });

        const articleId = res.data.data.articleId;
        if (this.generateMode === "now" && articleId) {
          await this.$router.push({ name: "article-detail", params: { id: articleId } });
        } else {
          await this.$router.push({
            name: "project-trends",
            params: { slug: this.slug },
            query: { tab: "pending" },
          });
        }
      } catch (err) {
        const message = err instanceof HttpError ? err.userMessage : this.$t("clusters.create.errorCreate") as string;
        this.$q.notify({ type: "negative", message });
      } finally {
        this.creating = false;
      }
    },
  },
});
</script>
