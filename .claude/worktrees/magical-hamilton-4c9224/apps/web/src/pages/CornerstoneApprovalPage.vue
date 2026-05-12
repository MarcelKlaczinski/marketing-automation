<template>
  <q-page padding>
    <div class="row items-center justify-between q-mb-md">
      <h5 class="q-my-none">{{ $t('cornerstones.approval.title') }}</h5>
      <q-btn-toggle
        v-model="statusFilter"
        :options="statusOptions"
        spread
        no-caps
        rounded
        unelevated
        toggle-color="primary"
        dense
      />
    </div>

    <div v-if="loading" class="text-center q-pa-xl">
      <q-spinner-dots size="2em" color="primary" />
    </div>

    <div v-else-if="filteredPairs.length === 0" class="text-center text-grey-6 q-pa-xl">
      {{ $t('cornerstones.approval.empty') }}
    </div>

    <template v-else>
      <CornerstonePairCard
        v-for="pair in filteredPairs"
        :key="pair.translationKey"
        :pair="pair"
        :slug="slug"
        @approved="fetchPairs"
        @rejected="fetchPairs"
      />
    </template>

    <div v-if="approvedClustersCount > 0" class="row justify-center q-mt-lg">
      <q-btn
        color="primary"
        size="lg"
        icon="play_arrow"
        :label="$t('cornerstones.approval.generateAllApproved', { count: approvedClustersCount })"
        :loading="generating"
        @click="generateAllApproved"
      />
    </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { Notify } from "quasar";
import { api } from "src/lib/api-client";
import CornerstonePairCard from "src/components/cornerstones/CornerstonePairCard.vue";
import type { CornerstonePair } from "src/components/cornerstones/types";

type StatusFilter = "proposed" | "approved" | "all";

export default defineComponent({
  name: "CornerstoneApprovalPage",
  components: { CornerstonePairCard },
  props: {
    slug: { type: String, required: true },
  },

  data: () => ({
    loading: false,
    generating: false,
    statusFilter: "proposed" as StatusFilter,
    pairs: [] as CornerstonePair[],
  }),

  computed: {
    statusOptions(): Array<{ label: string; value: StatusFilter }> {
      return [
        { label: this.$t("cornerstones.status.proposed") as string, value: "proposed" },
        { label: this.$t("cornerstones.status.approved") as string, value: "approved" },
        { label: this.$t("cornerstones.status.all") as string, value: "all" },
      ];
    },

    filteredPairs(): CornerstonePair[] {
      if (this.statusFilter === "all") return this.pairs;
      const filter = this.statusFilter;
      return this.pairs.filter(
        (p) => p.de?.status === filter || p.en?.status === filter
      );
    },

    approvedClustersCount(): number {
      const clusterIds = new Set<string>();
      for (const p of this.pairs) {
        if ((p.de?.status === "approved" || p.en?.status === "approved") && p.clusterId) {
          clusterIds.add(p.clusterId);
        }
      }
      return clusterIds.size;
    },
  },

  mounted() {
    void this.fetchPairs();
  },

  methods: {
    async fetchPairs(): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: { pairs: CornerstonePair[] } }>(
          `/projects/${this.slug}/cornerstone-specs`
        );
        this.pairs = res.data.data.pairs;
      } catch {
        // error surfaces via interceptor
      } finally {
        this.loading = false;
      }
    },

    async generateAllApproved(): Promise<void> {
      this.generating = true;
      try {
        const clusterIds = new Set<string>();
        for (const p of this.pairs) {
          if ((p.de?.status === "approved" || p.en?.status === "approved") && p.clusterId) {
            clusterIds.add(p.clusterId);
          }
        }

        let total = 0;
        for (const clusterId of clusterIds) {
          const res = await api.post<{ ok: boolean; data: { results: unknown[] } }>(
            `/projects/${this.slug}/clusters/${clusterId}/generate-articles`
          );
          total += res.data.data.results.length;
        }

        Notify.create({
          type: "positive",
          message: this.$t("cornerstones.approval.generationStarted", { total }) as string,
          timeout: 4000,
        });

        await this.fetchPairs();
      } catch {
        Notify.create({
          type: "negative",
          message: this.$t("cornerstones.notify.generationError") as string,
        });
      } finally {
        this.generating = false;
      }
    },
  },
});
</script>
