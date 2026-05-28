<template>
  <div class="detail-page">
    <header class="page-header">
      <q-btn flat icon="arrow_back" :label="backLabel" @click="goBack" />
    </header>

    <div v-if="loadError" class="state-banner error" role="alert">
      {{ $t("recurringContent.definitions.loadError") as string }}
    </div>

    <div v-else-if="loading" class="state-banner">{{ $t("common.loading") as string }}</div>

    <div v-else-if="!definition" class="state-banner">
      {{ $t("common.notFound") as string }}
    </div>

    <template v-else>
      <section class="definition-summary">
        <div class="summary-titles">
          <h1 class="def-title">{{ definition.name }}</h1>
          <div class="badges">
            <span class="badge">{{ formatTypeLabel(definition.formatType) }}</span>
            <span class="badge mono">{{ definition.frequency }}</span>
            <span v-if="!definition.isActive" class="badge inactive">
              {{ $t("recurringContent.definitions.inactiveChip") as string }}
            </span>
          </div>
        </div>
        <div class="actions">
          <q-btn
            outline
            :label="toggleLabel"
            :disable="busyAction !== null"
            @click="toggleActive"
          />
          <q-btn
            outline
            :label="$t('recurringContent.definitions.detail.actions.dryRun') as string"
            :disable="busyAction !== null"
            @click="dryRun"
          />
          <q-btn
            outline
            :label="$t('recurringContent.definitions.detail.actions.sampleImage') as string"
            :disable="busyAction !== null"
            @click="sampleImagePickerOpen = true"
          />
          <q-btn
            color="primary"
            :label="$t('recurringContent.definitions.detail.actions.runNow') as string"
            :disable="busyAction !== null || !definition.isActive"
            @click="confirmRunNow"
          />
          <q-btn
            flat
            icon="edit"
            @click="editorOpen = true"
          />
        </div>
      </section>

      <!-- Spec 65.16 V1.7 #3 — Sample-Render picker. Inline expansion below the
           action row when Marcel clicks "Sample render". Shows a preset
           dropdown (inherit + 3 options) + cost hint + render button.
           Cost ~€0.062/click (1k nano-banana-2), gated by the dry_run
           monthly budget. -->
      <section v-if="sampleImagePickerOpen" class="sample-image-picker">
        <div class="picker-header">
          <h3 class="picker-title">
            {{ $t("recurringContent.definitions.detail.sampleImage.title") as string }}
          </h3>
          <q-btn flat dense icon="close" @click="closeSampleImagePicker" />
        </div>
        <p class="picker-description">
          {{ $t("recurringContent.definitions.detail.sampleImage.description") as string }}
        </p>
        <div class="picker-controls">
          <label class="picker-field">
            <span class="picker-label">
              {{ $t("recurringContent.definitions.detail.sampleImage.presetLabel") as string }}
            </span>
            <select v-model="sampleImagePreset" class="picker-select">
              <option value="">
                {{ $t("recurringContent.definitions.detail.sampleImage.presetInherit") as string }}
              </option>
              <option value="dark-neon-grid">Dark Neon Grid</option>
              <option value="light-editorial">Light Editorial</option>
              <option value="blue-tech-gradient">Blue Tech Gradient</option>
            </select>
          </label>
          <q-btn
            color="primary"
            :label="$t('recurringContent.definitions.detail.sampleImage.render') as string"
            :loading="busyAction === 'sampleImage'"
            :disable="busyAction !== null"
            @click="renderSample"
          />
        </div>
        <small class="picker-hint">
          {{ $t("recurringContent.definitions.detail.sampleImage.costHint") as string }}
        </small>

        <div v-if="sampleImageResult" class="sample-image-result">
          <img
            :src="sampleImageResult.publicUrl"
            :alt="`Sample render — preset ${sampleImageResult.preset}`"
            class="sample-image-preview"
          />
          <dl class="sample-image-meta">
            <dt>{{ $t("recurringContent.definitions.detail.sampleImage.metaPreset") as string }}</dt>
            <dd class="mono">{{ sampleImageResult.preset }}</dd>
            <dt>{{ $t("recurringContent.definitions.detail.sampleImage.metaCost") as string }}</dt>
            <dd>~€{{ sampleImageResult.costEur.toFixed(3) }}</dd>
          </dl>
        </div>
      </section>

      <q-tabs v-model="activeTab" align="left" no-caps dark>
        <q-tab name="config" :label="$t('recurringContent.definitions.detail.tabs.config') as string" />
        <q-tab name="history" :label="$t('recurringContent.definitions.detail.tabs.history') as string" />
        <q-tab name="upcoming" :label="$t('recurringContent.definitions.detail.tabs.upcoming') as string" />
      </q-tabs>

      <q-tab-panels v-model="activeTab" animated dark class="tab-panels">
        <q-tab-panel name="config" class="panel">
          <dl class="config-grid">
            <dt>{{ $t("recurringContent.definitions.create.fields.formatType") as string }}</dt>
            <dd>{{ formatTypeLabel(definition.formatType) }}</dd>
            <dt>{{ $t("recurringContent.definitions.create.fields.frequency") as string }}</dt>
            <dd class="mono">{{ definition.frequency }}</dd>
            <dt>{{ $t("recurringContent.definitions.create.fields.nextRunAt") as string }}</dt>
            <dd>{{ formatDate(definition.nextRunAt) }}</dd>
            <dt>{{ $t("recurringContent.definitions.create.fields.templateStrategy") as string }}</dt>
            <dd class="mono">{{ definition.templateSelectionStrategy }}</dd>
            <dt v-if="definition.fixedTemplateKey">
              {{ $t("recurringContent.definitions.create.fields.fixedTemplateKey") as string }}
            </dt>
            <dd v-if="definition.fixedTemplateKey" class="mono">
              {{ definition.fixedTemplateKey }}
            </dd>
            <dt>{{ $t("recurringContent.definitions.create.fields.outputTargetsArticle") as string }}</dt>
            <dd>{{ definition.outputTargets.article ? "✓" : "—" }}</dd>
            <dt>{{ $t("recurringContent.definitions.create.fields.outputTargetsSocial") as string }}</dt>
            <dd>{{ definition.outputTargets.social ? "✓" : "—" }}</dd>
          </dl>
          <details class="config-json">
            <summary>{{ $t("recurringContent.definitions.create.fields.formatConfig") as string }}</summary>
            <pre class="json-block mono">{{ formatConfigPretty }}</pre>
          </details>
        </q-tab-panel>

        <q-tab-panel name="history" class="panel">
          <div v-if="history.length === 0" class="state-banner">
            {{ $t("recurringContent.definitions.detail.historyEmpty") as string }}
          </div>
          <table v-else class="history-table">
            <thead>
              <tr>
                <th>{{ $t("recurringContent.definitions.detail.historyTable.runNumber") as string }}</th>
                <th>{{ $t("recurringContent.definitions.detail.historyTable.createdAt") as string }}</th>
                <th>{{ $t("recurringContent.definitions.detail.historyTable.topicTitle") as string }}</th>
                <th>{{ $t("recurringContent.definitions.detail.historyTable.status") as string }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="brief in history"
                :key="brief.id"
                class="history-row"
                @click="openBrief(brief.id)"
              >
                <td class="mono">#{{ briefRunNumber(brief) }}</td>
                <td>{{ formatDate(brief.createdAt) }}</td>
                <td>{{ brief.topicTitle }}</td>
                <td>
                  <span class="status-chip mono">{{ brief.approvalStatus }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </q-tab-panel>

        <q-tab-panel name="upcoming" class="panel">
          <div v-if="upcoming.length === 0" class="state-banner">
            {{ $t("recurringContent.definitions.detail.upcomingEmpty") as string }}
          </div>
          <!--
            Spec 65.V1.5c — q-calendar replaces the 4-row list. Renders the
            current month + nav buttons; days with scheduled runs show a
            time-chip per run. The `upcoming` array is unchanged (still the
            server-resolved next 4 runs); the calendar widget handles the
            visualisation.
          -->
          <UpcomingRunsCalendar v-else :runs="upcoming" />
        </q-tab-panel>
      </q-tab-panels>

      <section v-if="dryRunResult" class="dry-run-result">
        <h3 class="result-title">
          {{ $t("recurringContent.definitions.detail.dryRunResult.title") as string }}
          <span :class="['result-status', dryRunResult.status]">
            {{ dryRunStatusLabel }}
          </span>
        </h3>
        <pre class="json-block mono">{{ JSON.stringify(dryRunResult, null, 2) }}</pre>
      </section>

      <RecurringDefinitionEditModal
        v-if="editorOpen"
        :slug="slug"
        :definition="definition"
        :format-types="formatTypes"
        @close="editorOpen = false"
        @saved="onSaved"
      />
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiGet, apiPatch, apiPost } from "src/lib/api";
import RecurringDefinitionEditModal from "src/components/settings/recurring-content/RecurringDefinitionEditModal.vue";
import UpcomingRunsCalendar from "src/components/settings/recurring-content/UpcomingRunsCalendar.vue";

interface FormatTypeInfo {
  key: string;
  family: "A" | "B";
  eligibleTemplates: string[];
  needsHooks: boolean;
  defaultEndSlides: string[];
}

interface RecurringDefinition {
  id: string;
  name: string;
  formatType: string;
  formatConfig: Record<string, unknown>;
  frequency: string;
  nextRunAt: string;
  lastRunAt: string | null;
  outputTargets: { article: boolean; social: boolean };
  templateSelectionStrategy: "fixed" | "lru" | "llm-picks" | "latest";
  fixedTemplateKey: string | null;
  endSlideStrategy: string;
  endSlidePool: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TopicBriefRow {
  id: string;
  topicTitle: string;
  approvalStatus: string;
  createdAt: string;
  recurringMetadata: { runNumber?: number } | null;
}

interface DryRunResult {
  status: "persisted" | "skipped" | "dry-run-preview";
  toolIds?: string[];
  templateKey?: string;
  templateSelectedVia?: string;
  endSlide?: { name: string; endSlideType: string; selectedVia: string };
  hookData?: { rendered: string };
  preview?: { topicTitle: string; briefText: string };
  reason?: string;
  detail?: string;
}

type PresetOverride = "" | "dark-neon-grid" | "light-editorial" | "blue-tech-gradient";

interface SampleImageResult {
  publicUrl: string;
  r2Key: string;
  preset: "dark-neon-grid" | "light-editorial" | "blue-tech-gradient";
  costEur: number;
  seed: number | null;
}

export default defineComponent({
  name: "SettingsRecurringDefinitionDetailPage",
  components: { RecurringDefinitionEditModal, UpcomingRunsCalendar },

  data: () => ({
    definition: null as RecurringDefinition | null,
    formatTypes: [] as FormatTypeInfo[],
    history: [] as TopicBriefRow[],
    upcoming: [] as string[],
    loading: true,
    loadError: false,
    activeTab: "config" as "config" | "history" | "upcoming",
    busyAction: null as null | "toggle" | "runNow" | "dryRun" | "sampleImage",
    dryRunResult: null as DryRunResult | null,
    editorOpen: false,
    // Spec 65.16 V1.7 #3 — sample-image picker state
    sampleImagePickerOpen: false,
    sampleImagePreset: "" as PresetOverride,
    sampleImageResult: null as SampleImageResult | null,
  }),

  computed: {
    slug(): string {
      return this.$route.params.slug as string;
    },
    definitionId(): string {
      return this.$route.params.id as string;
    },
    backLabel(): string {
      return this.$t("recurringContent.definitions.title") as string;
    },
    toggleLabel(): string {
      if (!this.definition) return "";
      return this.definition.isActive
        ? (this.$t(
            "recurringContent.definitions.detail.actions.toggleDeactivate",
          ) as string)
        : (this.$t(
            "recurringContent.definitions.detail.actions.toggleActivate",
          ) as string);
    },
    formatConfigPretty(): string {
      if (!this.definition) return "";
      return JSON.stringify(this.definition.formatConfig, null, 2);
    },
    dryRunStatusLabel(): string {
      if (!this.dryRunResult) return "";
      const key =
        this.dryRunResult.status === "persisted"
          ? "statusPersisted"
          : this.dryRunResult.status === "skipped"
            ? "statusSkipped"
            : "statusPreview";
      return this.$t(
        `recurringContent.definitions.detail.dryRunResult.${key}`,
      ) as string;
    },
  },

  mounted() {
    void this.loadAll();
  },

  methods: {
    async loadAll(): Promise<void> {
      this.loading = true;
      this.loadError = false;
      try {
        const [defResp, ftResp, histResp, upResp] = await Promise.all([
          apiGet<{ definition: RecurringDefinition }>(
            `/projects/${this.slug}/recurring-content/definitions/${this.definitionId}`,
          ),
          apiGet<{ formatTypes: FormatTypeInfo[] }>(
            `/projects/${this.slug}/recurring-content/definitions/format-types`,
          ),
          apiGet<{ items: TopicBriefRow[]; total: number }>(
            `/projects/${this.slug}/recurring-content/definitions/${this.definitionId}/history?limit=50`,
          ),
          apiGet<{ upcoming: string[] }>(
            `/projects/${this.slug}/recurring-content/definitions/${this.definitionId}/upcoming?count=4`,
          ),
        ]);
        this.definition = defResp.definition;
        this.formatTypes = ftResp.formatTypes;
        this.history = histResp.items;
        this.upcoming = upResp.upcoming;
      } catch (err) {
        this.loadError = true;
        // biome-ignore lint/suspicious/noConsoleLog: dev diagnostic
        if (import.meta.env.DEV) console.warn("[recurring-def-detail] load", err);
      } finally {
        this.loading = false;
      }
    },

    formatTypeLabel(key: string): string {
      const label = this.$t(`recurringContent.definitions.formatType.${key}`);
      return typeof label === "string" && !label.startsWith("recurringContent.")
        ? label
        : key;
    },

    formatDate(iso: string): string {
      const d = new Date(iso);
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
    },

    briefRunNumber(brief: TopicBriefRow): string {
      return String(brief.recurringMetadata?.runNumber ?? "?");
    },

    goBack(): void {
      void this.$router.push({
        path: `/projects/${this.slug}/settings/recurring-content`,
      });
    },

    /**
     * Open a history-row's brief in the universal Brief-Detail page where
     * Marcel can approve (dispatch=immediate / dispatch=plan) and, once the
     * social-image pipeline has run, jump to the rendered article. The
     * Verlauf tab here is the entry — the actual approve+render UX lives
     * in `/projects/:slug/briefs/:briefId`.
     */
    openBrief(briefId: string): void {
      void this.$router.push({
        path: `/projects/${this.slug}/briefs/${briefId}`,
      });
    },

    async toggleActive(): Promise<void> {
      if (!this.definition) return;
      this.busyAction = "toggle";
      const next = !this.definition.isActive;
      try {
        await apiPatch(
          `/projects/${this.slug}/recurring-content/definitions/${this.definitionId}/active`,
          { isActive: next },
        );
        this.definition = { ...this.definition, isActive: next };
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "toggle_failed",
        });
      } finally {
        this.busyAction = null;
      }
    },

    confirmRunNow(): void {
      this.$q.dialog({
        title: this.$t(
          "recurringContent.definitions.detail.runNowDialog.title",
        ) as string,
        message: this.$t(
          "recurringContent.definitions.detail.runNowDialog.message",
        ) as string,
        cancel: { flat: true, color: "white" },
        persistent: true,
      }).onOk(() => {
        void this.runNow();
      });
    },

    async runNow(): Promise<void> {
      this.busyAction = "runNow";
      try {
        await apiPost(
          `/projects/${this.slug}/recurring-content/definitions/${this.definitionId}/run-now`,
        );
        this.$q.notify({
          type: "positive",
          message: this.$t(
            "recurringContent.definitions.detail.actions.runNowSuccess",
          ) as string,
        });
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "run_now_failed",
        });
      } finally {
        this.busyAction = null;
      }
    },

    async dryRun(): Promise<void> {
      this.busyAction = "dryRun";
      this.dryRunResult = null;
      try {
        const data = await apiPost<{ result: DryRunResult }>(
          `/projects/${this.slug}/recurring-content/definitions/${this.definitionId}/dry-run`,
        );
        this.dryRunResult = data.result;
        this.$q.notify({
          type: "positive",
          message: this.$t(
            "recurringContent.definitions.detail.actions.dryRunSuccess",
          ) as string,
        });
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: this.$t(
            "recurringContent.definitions.detail.actions.dryRunFailed",
          ) as string,
          caption: err instanceof Error ? err.message : "",
        });
      } finally {
        this.busyAction = null;
      }
    },

    onSaved(): void {
      this.editorOpen = false;
      void this.loadAll();
    },

    closeSampleImagePicker(): void {
      this.sampleImagePickerOpen = false;
      this.sampleImageResult = null;
      this.sampleImagePreset = "";
    },

    async renderSample(): Promise<void> {
      this.busyAction = "sampleImage";
      this.sampleImageResult = null;
      try {
        const body =
          this.sampleImagePreset === ""
            ? {}
            : { presetOverride: this.sampleImagePreset };
        const data = await apiPost<{ result: SampleImageResult }>(
          `/projects/${this.slug}/recurring-content/definitions/${this.definitionId}/sample-image`,
          body,
        );
        this.sampleImageResult = data.result;
        this.$q.notify({
          type: "positive",
          message: this.$t(
            "recurringContent.definitions.detail.sampleImage.success",
          ) as string,
        });
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: this.$t(
            "recurringContent.definitions.detail.sampleImage.failed",
          ) as string,
          caption: err instanceof Error ? err.message : "",
        });
      } finally {
        this.busyAction = null;
      }
    },
  },
});
</script>

<style scoped>
.detail-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 48px;
}

.page-header {
  display: flex;
}

.definition-summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-glass-strong);
}
.summary-titles {
  flex: 1;
}
.def-title {
  margin: 0 0 8px;
  font-size: 22px;
  font-weight: 600;
}
.badges {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.badge {
  background: var(--bg-base);
  border: 1px solid var(--border-subtle);
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-secondary);
}
.badge.inactive {
  color: var(--text-tertiary);
}
.actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tab-panels {
  background: transparent;
  color: var(--text-primary);
}
.tab-panels :deep(.q-tab-panel) {
  background: transparent;
  color: var(--text-primary);
}
.panel {
  padding: 20px 0;
}

.config-grid {
  display: grid;
  grid-template-columns: minmax(180px, max-content) 1fr;
  gap: 10px 18px;
  font-size: 13px;
  margin: 0 0 12px;
}
.config-grid dt {
  color: var(--text-tertiary);
}
.config-grid dd {
  margin: 0;
  color: var(--text-primary);
}
.config-json {
  margin-top: 8px;
}
.config-json summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
}

.history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.history-table th,
.history-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
}
.history-table th {
  color: var(--text-tertiary);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 500;
}
.history-row {
  cursor: pointer;
  transition: background-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
@media (hover: hover) and (pointer: fine) {
  .history-row:hover {
    background: var(--bg-glass);
  }
}
.status-chip {
  background: var(--bg-glass-strong);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
}

.upcoming-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.upcoming-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  background: var(--bg-glass-strong);
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.upcoming-index {
  color: var(--text-tertiary);
  min-width: 32px;
}

.dry-run-result {
  margin-top: 24px;
  padding: 16px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}
.result-title {
  margin: 0 0 10px;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.result-status {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-glass-strong);
}
.result-status.persisted {
  color: var(--color-success, #4ade80);
}
.result-status.skipped {
  color: var(--color-warning, #f5a623);
}
.json-block {
  background: var(--bg-base);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 12px;
  overflow-x: auto;
  font-size: 12px;
  color: var(--text-secondary);
}

/* Spec 65.16 V1.7 #3 — sample-image picker */
.sample-image-picker {
  margin-top: 16px;
  padding: 18px 20px;
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
  border-radius: var(--radius-md, 10px);
  background: var(--bg-glass-strong, rgba(255, 255, 255, 0.04));
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.picker-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.picker-description {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary, rgba(255, 255, 255, 0.75));
}
.picker-controls {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}
.picker-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 240px;
}
.picker-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, rgba(255, 255, 255, 0.75));
}
.picker-select {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
  background: var(--bg-glass-strong, rgba(255, 255, 255, 0.04));
  color: var(--text-primary, rgba(255, 255, 255, 0.92));
  font-size: 13px;
  cursor: pointer;
}
.picker-hint {
  font-size: 11px;
  color: var(--text-tertiary, rgba(255, 255, 255, 0.55));
}
.sample-image-result {
  display: grid;
  grid-template-columns: minmax(0, 280px) 1fr;
  gap: 16px;
  align-items: start;
  margin-top: 6px;
}
.sample-image-preview {
  width: 100%;
  border-radius: 8px;
  display: block;
}
.sample-image-meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  align-content: start;
  font-size: 13px;
}
.sample-image-meta dt {
  color: var(--text-secondary, rgba(255, 255, 255, 0.75));
}
.sample-image-meta dd {
  margin: 0;
  color: var(--text-primary, rgba(255, 255, 255, 0.92));
}
@media (max-width: 560px) {
  .sample-image-result {
    grid-template-columns: 1fr;
  }
}
.state-banner {
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: var(--bg-glass-strong);
  color: var(--text-secondary);
  font-size: 13px;
}
.state-banner.error {
  color: var(--color-danger, #e44);
}
.mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
}
</style>
