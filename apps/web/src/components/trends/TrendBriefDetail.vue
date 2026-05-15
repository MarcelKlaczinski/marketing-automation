<template>
  <q-card flat bordered>
    <q-card-section class="row items-start q-gutter-sm">
      <div class="col">
        <div class="text-h6 text-weight-medium">{{ brief.topicTitle }}</div>
        <div class="row items-center q-gutter-xs q-mt-xs">
          <q-badge :color="scoreColor(trendScore)" class="q-px-sm">
            {{ $t('trends.score') }}: {{ trendScore }}
          </q-badge>
          <q-badge
            v-if="freshnessWindow"
            :color="freshnessColor(freshnessWindow)"
            outline
          >
            {{ $t(`trends.freshness.${freshnessWindow}`) }}
          </q-badge>
          <q-badge
            :color="brief.clusterAction === 'create_new' ? 'orange' : 'blue'"
            outline
          >
            {{ $t(`trends.clusterAction.${brief.clusterAction}`) }}
          </q-badge>
        </div>
      </div>
    </q-card-section>

    <!-- create_new disabled banner -->
    <q-banner
      v-if="brief.clusterAction === 'create_new'"
      dense
      rounded
      class="bg-blue-1 text-blue-10 q-mx-md q-mb-md"
    >
      <template #avatar><q-icon name="info" color="blue" /></template>
      {{ $t('trends.detail.createNewDisabledBanner') }}
    </q-banner>

    <q-separator />

    <!-- Score Breakdown -->
    <q-card-section>
      <div class="text-subtitle2 q-mb-sm">{{ $t('trends.detail.scoreBreakdown') }}</div>
      <div v-if="scoreBreakdown" class="score-breakdown">
        <div v-for="row in scoreRows" :key="row.key" class="score-breakdown__row">
          <span class="score-breakdown__label text-caption text-grey-7">{{ $t(`trends.detail.${row.key}`) }}</span>
          <q-linear-progress
            :value="row.value / 100"
            :color="row.negative ? 'negative' : 'primary'"
            rounded
            size="8px"
            class="score-breakdown__bar"
          />
          <span class="score-breakdown__value text-caption" :class="row.negative ? 'text-negative' : ''">
            {{ row.negative ? '-' : '' }}{{ row.value }}
          </span>
        </div>
        <q-separator class="q-my-xs" />
        <div class="score-breakdown__row text-weight-medium">
          <span class="score-breakdown__label text-caption">{{ $t('trends.detail.totalScore') }}</span>
          <div class="score-breakdown__bar" />
          <span class="score-breakdown__value">{{ trendScore }}</span>
        </div>
      </div>
      <div v-else class="text-grey-6 text-caption">—</div>
    </q-card-section>

    <!-- Routing Preview -->
    <q-card-section class="q-pt-none">
      <div class="text-subtitle2 q-mb-xs">{{ $t('trends.detail.routingPreview') }}</div>
      <div v-if="brief.clusterAction === 'create_new'" class="text-orange text-caption">
        {{ $t('trends.detail.routingCreateNew') }}
      </div>
      <div v-else-if="brief.clusterId" class="text-caption text-grey-8">
        {{ $t('trends.detail.routingAppend', { cluster: brief.clusterId.slice(0, 8), intent: brief.intentType ?? '—' }) }}
      </div>
      <div v-else class="text-caption text-grey-6">{{ $t('trends.detail.noCluster') }}</div>
    </q-card-section>

    <!-- Signals -->
    <q-card-section class="q-pt-none">
      <q-expansion-item
        :label="$t('trends.detail.signals')"
        dense
        header-class="text-subtitle2 q-px-none"
        default-opened
      >
        <div v-if="signals.length > 0" class="q-mt-xs">
          <div
            v-for="(sig, idx) in signals"
            :key="sig.externalId + idx"
            class="signal-row q-py-xs"
          >
            <q-badge :color="sourceColor(sig.source)" dense>{{ $t(`trends.sources.${sig.source}`) }}</q-badge>
            <span class="q-ml-xs text-caption text-grey-8">{{ sig.externalId }}</span>
            <span class="q-ml-sm text-caption text-grey-6">{{ formatDate(sig.capturedAt) }}</span>
            <a
              v-if="sig.url"
              :href="sig.url"
              target="_blank"
              rel="noopener"
              class="q-ml-sm text-caption text-primary"
            >
              {{ $t('trends.detail.openUrl') }}
            </a>
          </div>
        </div>
        <div v-else class="text-grey-6 text-caption q-mt-xs">{{ $t('trends.detail.noSignals') }}</div>
      </q-expansion-item>
    </q-card-section>

    <q-separator />

    <!-- Suggested Fields -->
    <q-card-section>
      <div class="row items-center q-mb-sm">
        <div class="text-subtitle2 col">{{ $t('trends.detail.suggestedFields') }}</div>
        <q-btn
          v-if="!editMode && brief.clusterAction !== 'create_new'"
          flat
          dense
          no-caps
          icon="edit"
          :label="$t('trends.detail.editMode')"
          color="primary"
          size="sm"
          @click="enterEditMode"
        />
      </div>

      <!-- View mode -->
      <template v-if="!editMode">
        <div class="field-row">
          <div class="field-row__label text-caption text-grey-7">{{ $t('trends.detail.suggestedTitle') }}</div>
          <div class="field-row__value">{{ brief.suggestedTitle ?? '—' }}</div>
        </div>
        <div class="field-row q-mt-xs">
          <div class="field-row__label text-caption text-grey-7">{{ $t('trends.detail.suggestedMeta') }}</div>
          <div class="field-row__value text-caption">{{ brief.suggestedMeta ?? '—' }}</div>
        </div>
        <div class="field-row q-mt-xs">
          <div class="field-row__label text-caption text-grey-7">{{ $t('trends.detail.suggestedSlug') }}</div>
          <div class="field-row__value text-caption" style="font-family: monospace;">{{ brief.suggestedSlug ?? '—' }}</div>
        </div>
        <div v-if="brief.heroImagePrompt" class="field-row q-mt-xs">
          <div class="field-row__label text-caption text-grey-7">{{ $t('trends.detail.heroPrompt') }}</div>
          <div class="field-row__value text-caption text-grey-8">{{ brief.heroImagePrompt }}</div>
        </div>
      </template>

      <!-- Edit mode -->
      <template v-else>
        <q-input
          v-model="editTitle"
          outlined
          dense
          :label="$t('trends.detail.suggestedTitle') as string"
          :error="!!editErrors.title"
          :error-message="editErrors.title"
          :counter="true"
          maxlength="200"
          class="q-mb-sm"
        />
        <q-input
          v-model="editMeta"
          outlined
          dense
          type="textarea"
          :label="$t('trends.detail.suggestedMeta') as string"
          :error="!!editErrors.meta"
          :error-message="editErrors.meta"
          :counter="true"
          maxlength="160"
          rows="3"
          class="q-mb-sm"
        />
        <q-input
          v-model="editSlug"
          outlined
          dense
          :label="$t('trends.detail.suggestedSlug') as string"
          :error="!!editErrors.slug"
          :error-message="editErrors.slug"
          class="q-mb-sm"
          style="font-family: monospace;"
        />
        <div class="row q-gutter-sm">
          <q-btn
            unelevated
            no-caps
            color="primary"
            :label="$t('trends.detail.saveEdits') as string"
            :loading="saving"
            size="sm"
            @click="saveEdits"
          />
          <q-btn
            flat
            no-caps
            :label="$t('trends.detail.cancelEdit') as string"
            size="sm"
            @click="cancelEditMode"
          />
        </div>
      </template>
    </q-card-section>

    <!-- Action bar -->
    <q-separator />
    <q-card-actions class="q-pa-md row q-gutter-sm">
      <q-btn
        unelevated
        no-caps
        color="positive"
        icon="check"
        :label="$t('trends.detail.approveQueue') as string"
        :loading="approving"
        :disable="brief.clusterAction === 'create_new' || editMode"
        size="sm"
        @click="confirmApprove('queue')"
      />
      <q-btn
        unelevated
        no-caps
        color="positive"
        icon="bolt"
        :label="$t('trends.detail.approveGenerate') as string"
        :loading="approving"
        :disable="brief.clusterAction === 'create_new' || editMode"
        size="sm"
        @click="confirmApprove('generate')"
      />
      <q-space />
      <q-btn
        flat
        no-caps
        color="negative"
        icon="close"
        :label="$t('trends.detail.dismiss') as string"
        :loading="dismissing"
        :disable="editMode"
        size="sm"
        @click="confirmDismiss"
      />
    </q-card-actions>

    <!-- Approve confirmation dialog -->
    <q-dialog v-model="approveDialogOpen">
      <q-card style="min-width: 320px">
        <q-card-section>
          <div class="text-h6">{{ $t('trends.detail.confirmApprove') }}</div>
        </q-card-section>
        <q-card-section class="q-pt-none text-body2 text-grey-8">
          {{ $t('trends.detail.confirmApproveText', { title: brief.suggestedTitle ?? brief.topicTitle }) }}
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps :label="$t('trends.detail.cancel') as string" v-close-popup />
          <q-btn
            unelevated
            no-caps
            color="positive"
            :label="$t('trends.detail.confirm') as string"
            :loading="approving"
            @click="doApprove"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Dismiss confirmation dialog -->
    <q-dialog v-model="dismissDialogOpen">
      <q-card style="min-width: 320px">
        <q-card-section>
          <div class="text-h6">{{ $t('trends.detail.confirmDismiss') }}</div>
        </q-card-section>
        <q-card-section class="q-pt-none text-body2 text-grey-8">
          {{ $t('trends.detail.confirmDismissText') }}
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps :label="$t('trends.detail.cancel') as string" v-close-popup />
          <q-btn
            unelevated
            no-caps
            color="negative"
            :label="$t('trends.detail.confirm') as string"
            :loading="dismissing"
            @click="doDismiss"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-card>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { useQuasar } from "quasar";
import { api } from "src/lib/api-client";
import { HttpError } from "src/lib/http-error";

interface SignalRow {
  id?: string;
  source: string;
  externalId: string;
  url?: string;
  capturedAt: string;
}

interface ScoreBreakdownData {
  communityBuzz: number;
  searchVolumeGrowth: number;
  officialAnnouncement: number;
  serpVolatility: number;
  existingCoveragePenalty: number;
}

interface TrendMetadataData {
  trendScore: number;
  freshnessWindow: "breaking" | "rising" | "stable";
  signals: SignalRow[];
  scoreBreakdown?: ScoreBreakdownData;
}

export interface TrendBriefDetailData {
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
  trendMetadata: TrendMetadataData | null;
}

type ApproveMode = "queue" | "generate";

const SOURCE_COLORS: Record<string, string> = {
  producthunt: "deep-orange",
  hackernews: "orange",
  vendor_rss: "teal",
  reddit: "red",
  github: "grey-8",
  dataforseo_trends: "indigo",
};

export default defineComponent({
  name: "TrendBriefDetail",

  props: {
    brief: {
      type: Object as PropType<TrendBriefDetailData>,
      required: true,
    },
    projectSlug: { type: String, required: true },
  },

  emits: ["approved", "dismissed", "edited"],

  setup() {
    return { $q: useQuasar() };
  },

  data: () => ({
    editMode: false,
    editTitle: "" as string,
    editMeta: "" as string,
    editSlug: "" as string,
    editErrors: { title: "", meta: "", slug: "" },
    saving: false,
    approving: false,
    dismissing: false,
    approveDialogOpen: false,
    dismissDialogOpen: false,
    pendingMode: "queue" as ApproveMode,
  }),

  computed: {
    trendScore(): number {
      return this.brief.trendMetadata?.trendScore ?? 0;
    },

    freshnessWindow(): "breaking" | "rising" | "stable" | null {
      return this.brief.trendMetadata?.freshnessWindow ?? null;
    },

    signals(): SignalRow[] {
      return this.brief.trendMetadata?.signals ?? [];
    },

    scoreBreakdown(): ScoreBreakdownData | null {
      return this.brief.trendMetadata?.scoreBreakdown ?? null;
    },

    scoreRows(): Array<{ key: string; value: number; negative: boolean }> {
      const b = this.scoreBreakdown;
      if (!b) return [];
      return [
        { key: "communityBuzz",          value: b.communityBuzz,          negative: false },
        { key: "searchVolumeGrowth",      value: b.searchVolumeGrowth,     negative: false },
        { key: "officialAnnouncement",    value: b.officialAnnouncement,   negative: false },
        { key: "serpVolatility",          value: b.serpVolatility,         negative: false },
        { key: "sourceDiversity",         value: 0,                        negative: false }, // stored in total
        { key: "coveragePenalty",         value: b.existingCoveragePenalty, negative: true },
      ];
    },
  },

  methods: {
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

    sourceColor(src: string): string {
      return SOURCE_COLORS[src] ?? "grey-6";
    },

    formatDate(iso: string): string {
      try {
        return new Date(iso).toLocaleDateString(
          this.$i18n.locale === "de" ? "de-DE" : "en-US",
          { day: "2-digit", month: "2-digit", year: "2-digit" },
        );
      } catch {
        return iso;
      }
    },

    enterEditMode(): void {
      this.editTitle = this.brief.suggestedTitle ?? "";
      this.editMeta  = this.brief.suggestedMeta  ?? "";
      this.editSlug  = this.brief.suggestedSlug  ?? "";
      this.editErrors = { title: "", meta: "", slug: "" };
      this.editMode = true;
    },

    cancelEditMode(): void {
      this.editMode = false;
      this.editErrors = { title: "", meta: "", slug: "" };
    },

    validateEdit(): boolean {
      this.editErrors = { title: "", meta: "", slug: "" };
      let ok = true;

      if (this.editTitle && (this.editTitle.length < 10 || this.editTitle.length > 200)) {
        this.editErrors.title = this.$t("trends.detail.editValidationTitle") as string;
        ok = false;
      }
      if (this.editMeta && (this.editMeta.length < 50 || this.editMeta.length > 160)) {
        this.editErrors.meta = this.$t("trends.detail.editValidationMeta") as string;
        ok = false;
      }
      if (this.editSlug && !/^[a-z0-9-]+$/.test(this.editSlug)) {
        this.editErrors.slug = this.$t("trends.detail.editValidationSlug") as string;
        ok = false;
      }
      return ok;
    },

    async saveEdits(): Promise<void> {
      if (!this.validateEdit()) return;
      const body: Record<string, string> = {};
      if (this.editTitle) body.suggestedTitle = this.editTitle;
      if (this.editMeta)  body.suggestedMeta  = this.editMeta;
      if (this.editSlug)  body.suggestedSlug  = this.editSlug;
      if (Object.keys(body).length === 0) { this.cancelEditMode(); return; }

      this.saving = true;
      try {
        await api.post(
          `/projects/${this.projectSlug}/trends/briefs/${this.brief.id}/edit`,
          body,
        );
        this.$q.notify({ type: "positive", message: this.$t("trends.detail.editSuccess") as string });
        this.editMode = false;
        this.$emit("edited");
      } catch (e) {
        const msg = e instanceof HttpError ? e.userMessage : String(e);
        this.$q.notify({ type: "negative", message: msg });
      } finally {
        this.saving = false;
      }
    },

    confirmApprove(mode: ApproveMode): void {
      this.pendingMode = mode;
      this.approveDialogOpen = true;
    },

    async doApprove(): Promise<void> {
      this.approveDialogOpen = false;
      this.approving = true;
      try {
        await api.post(
          `/projects/${this.projectSlug}/trends/briefs/${this.brief.id}/approve`,
          { mode: this.pendingMode },
        );
        this.$q.notify({ type: "positive", message: this.$t("trends.detail.approveSuccess") as string });
        this.$emit("approved");
      } catch (e) {
        const msg = e instanceof HttpError ? e.userMessage : String(e);
        this.$q.notify({ type: "negative", message: msg });
      } finally {
        this.approving = false;
      }
    },

    confirmDismiss(): void {
      this.dismissDialogOpen = true;
    },

    async doDismiss(): Promise<void> {
      this.dismissDialogOpen = false;
      this.dismissing = true;
      try {
        await api.post(
          `/projects/${this.projectSlug}/trends/briefs/${this.brief.id}/dismiss`,
        );
        this.$q.notify({ type: "positive", message: this.$t("trends.detail.dismissSuccess") as string });
        this.$emit("dismissed");
      } catch (e) {
        const msg = e instanceof HttpError ? e.userMessage : String(e);
        this.$q.notify({ type: "negative", message: msg });
      } finally {
        this.dismissing = false;
      }
    },
  },
});
</script>

<style scoped>
.score-breakdown {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.score-breakdown__row {
  display: grid;
  grid-template-columns: 160px 1fr 36px;
  align-items: center;
  gap: 8px;
}

.score-breakdown__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.score-breakdown__value {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.signal-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  border-bottom: 1px solid rgba(0,0,0,0.04);
}

.field-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 4px;
  align-items: start;
}

.field-row__label { padding-top: 2px; }
</style>
