<template>
  <q-card class="cornerstone-pair-card q-mb-md">
    <q-card-section>
      <div class="row q-col-gutter-md">
        <!-- DE side -->
        <div class="col-12 col-md-6">
          <div class="row items-center q-mb-sm">
            <q-badge color="blue-8" class="q-mr-xs">DE</q-badge>
            <q-badge :color="statusColor(pair.de?.status)" outline>
              {{ specStatusLabel(pair.de?.status) }}
            </q-badge>
          </div>
          <SpecPreview v-if="pair.de" :spec="pair.de" />
          <div v-else class="text-grey-5 text-caption">
            {{ $t('cornerstones.pair.missingDe') }}
          </div>
        </div>

        <!-- EN side -->
        <div class="col-12 col-md-6">
          <div class="row items-center q-mb-sm">
            <q-badge color="green-8" class="q-mr-xs">EN</q-badge>
            <q-badge :color="statusColor(pair.en?.status)" outline>
              {{ specStatusLabel(pair.en?.status) }}
            </q-badge>
          </div>
          <SpecPreview v-if="pair.en" :spec="pair.en" />
          <div v-else class="text-grey-5 text-caption">
            {{ $t('cornerstones.pair.missingEn') }}
          </div>
        </div>
      </div>
    </q-card-section>

    <q-separator />

    <q-card-actions align="right">
      <q-btn
        v-if="canApprovePair"
        flat
        color="positive"
        :label="$t('cornerstones.pair.approveBoth')"
        :loading="approvingPair"
        @click="approvePair"
      />
      <q-btn
        v-if="pair.de && pair.de.status === 'proposed'"
        flat
        size="sm"
        :label="$t('cornerstones.pair.approveDeOnly')"
        :loading="approvingDe"
        @click="approveSpec(pair.de, 'de')"
      />
      <q-btn
        v-if="pair.en && pair.en.status === 'proposed'"
        flat
        size="sm"
        :label="$t('cornerstones.pair.approveEnOnly')"
        :loading="approvingEn"
        @click="approveSpec(pair.en, 'en')"
      />
      <q-btn
        flat
        color="negative"
        icon="close"
        :title="$t('cornerstones.actions.reject')"
        @click="openRejectDialog"
      />
    </q-card-actions>

    <CornerstoneRejectDialog
      v-model="rejectDialogOpen"
      :pair="pair"
      :slug="slug"
      :spec="rejectTarget"
      @rejected="$emit('rejected')"
    />
  </q-card>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { Notify } from "quasar";
import { api } from "src/lib/api-client";
import SpecPreview from "./SpecPreview.vue";
import CornerstoneRejectDialog from "./CornerstoneRejectDialog.vue";
import type { CornerstoneSpec, CornerstonePair, CornerstoneStatus } from "./types";

const STATUS_LABELS: Record<string, string> = {
  proposed: "proposed",
  approved: "approved",
  in_generation: "inGeneration",
  article_done: "articleDone",
  rejected: "rejected",
};

export default defineComponent({
  name: "CornerstonePairCard",
  components: { SpecPreview, CornerstoneRejectDialog },
  emits: ["approved", "rejected"],
  props: {
    pair: { type: Object as PropType<CornerstonePair>, required: true },
    slug: { type: String, required: true },
  },

  data: () => ({
    rejectDialogOpen: false,
    rejectTarget: null as CornerstoneSpec | null,
    approvingPair: false,
    approvingDe: false,
    approvingEn: false,
  }),

  computed: {
    canApprovePair(): boolean {
      return this.pair.de?.status === "proposed" && this.pair.en?.status === "proposed";
    },
  },

  methods: {
    statusColor(status?: CornerstoneStatus | null): string {
      switch (status) {
        case "proposed": return "blue-5";
        case "approved": return "green-6";
        case "in_generation": return "orange-6";
        case "article_done": return "teal-6";
        case "rejected": return "red-6";
        default: return "grey-5";
      }
    },

    specStatusLabel(status?: CornerstoneStatus | null): string {
      const key = status ? STATUS_LABELS[status] : null;
      if (!key) return this.$t("cornerstones.status.missing") as string;
      return this.$t(`cornerstones.status.${key}`) as string;
    },

    async approvePair(): Promise<void> {
      this.approvingPair = true;
      try {
        await api.post(
          `/projects/${this.slug}/cornerstone-specs/pair/${this.pair.translationKey}/approve`
        );
        Notify.create({ type: "positive", message: this.$t("cornerstones.notify.pairApproved") as string });
        this.$emit("approved");
      } catch {
        Notify.create({ type: "negative", message: this.$t("cornerstones.notify.generationError") as string });
      } finally {
        this.approvingPair = false;
      }
    },

    async approveSpec(spec: CornerstoneSpec, locale: "de" | "en"): Promise<void> {
      if (locale === "de") this.approvingDe = true;
      else this.approvingEn = true;
      try {
        await api.post(`/projects/${this.slug}/cornerstone-specs/${spec.id}/approve`);
        Notify.create({ type: "positive", message: this.$t("cornerstones.notify.specApproved") as string });
        this.$emit("approved");
      } catch {
        Notify.create({ type: "negative", message: this.$t("cornerstones.notify.generationError") as string });
      } finally {
        if (locale === "de") this.approvingDe = false;
        else this.approvingEn = false;
      }
    },

    openRejectDialog(): void {
      // Reject whichever spec is proposed (prefer DE, fallback EN)
      this.rejectTarget =
        this.pair.de?.status === "proposed"
          ? this.pair.de
          : this.pair.en?.status === "proposed"
          ? this.pair.en
          : this.pair.de;
      this.rejectDialogOpen = true;
    },
  },
});
</script>

<style scoped>
.cornerstone-pair-card {
  border-left: 3px solid var(--q-primary);
}
</style>
