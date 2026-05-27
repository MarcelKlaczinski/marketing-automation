<template>
  <div class="rc-page">
    <header class="page-header">
      <div class="header-titles">
        <h1 class="page-title">{{ $t("recurringContent.definitions.title") as string }}</h1>
        <p class="page-description">
          {{ $t("recurringContent.definitions.description") as string }}
        </p>
      </div>
      <q-btn
        color="primary"
        icon="add"
        :label="$t('recurringContent.definitions.newDefinition') as string"
        @click="openCreate"
      />
    </header>

    <section class="filters">
      <label class="filter-row">
        <span class="filter-label">{{ $t("recurringContent.definitions.filters.formatType") as string }}</span>
        <select v-model="formatTypeFilter" class="select-input">
          <option value="">{{ $t("recurringContent.definitions.filters.formatTypeAll") as string }}</option>
          <option v-for="ft in formatTypes" :key="ft.key" :value="ft.key">
            {{ $t(`recurringContent.definitions.formatType.${ft.key}`) as string }}
          </option>
        </select>
      </label>
      <label class="filter-row">
        <input v-model="includeInactive" type="checkbox" />
        <span>{{ $t("recurringContent.definitions.filters.includeInactive") as string }}</span>
      </label>
    </section>

    <div v-if="loadError" class="state-banner error" role="alert">
      {{ $t("recurringContent.definitions.loadError") as string }}
    </div>

    <div v-else-if="loading" class="state-banner">{{ $t("common.loading") as string }}</div>

    <div v-else-if="filteredDefinitions.length === 0" class="state-banner">
      {{ $t("recurringContent.definitions.empty") as string }}
    </div>

    <table v-else class="def-table">
      <thead>
        <tr>
          <th>{{ $t("recurringContent.definitions.columns.name") as string }}</th>
          <th>{{ $t("recurringContent.definitions.columns.formatType") as string }}</th>
          <th>{{ $t("recurringContent.definitions.columns.frequency") as string }}</th>
          <th>{{ $t("recurringContent.definitions.columns.nextRun") as string }}</th>
          <th>{{ $t("recurringContent.definitions.columns.active") as string }}</th>
          <th class="row-actions" />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="def in filteredDefinitions"
          :key="def.id"
          :class="{ inactive: !def.isActive }"
          @click="openDetail(def.id)"
        >
          <td class="def-name">{{ def.name }}</td>
          <td class="mono">{{ formatTypeLabel(def.formatType) }}</td>
          <td class="mono">{{ def.frequency }}</td>
          <td>{{ formatDate(def.nextRunAt) }}</td>
          <td>
            <span v-if="def.isActive" class="chip-active">●</span>
            <span v-else class="chip-inactive">
              {{ $t("recurringContent.definitions.inactiveChip") as string }}
            </span>
          </td>
          <td class="row-actions">
            <q-btn
              flat
              size="sm"
              :label="$t('recurringContent.definitions.rowOpen') as string"
              @click.stop="openDetail(def.id)"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <RecurringDefinitionEditModal
      v-if="editorOpen"
      :slug="slug"
      :definition="editing"
      :format-types="formatTypes"
      @close="closeEditor"
      @saved="onSaved"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiGet } from "src/lib/api";
import RecurringDefinitionEditModal from "src/components/settings/recurring-content/RecurringDefinitionEditModal.vue";

interface FormatTypeInfo {
  key: string;
  family: "A" | "B";
  eligibleTemplates: string[];
  needsHooks: boolean;
  defaultEndSlides: string[];
}

interface RecurringDefinition {
  id: string;
  projectId: string;
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

export default defineComponent({
  name: "SettingsRecurringDefinitionsPage",
  components: { RecurringDefinitionEditModal },

  data: () => ({
    definitions: [] as RecurringDefinition[],
    formatTypes: [] as FormatTypeInfo[],
    loading: true,
    loadError: false,
    formatTypeFilter: "",
    includeInactive: true,
    editorOpen: false,
    editing: null as RecurringDefinition | null,
  }),

  computed: {
    slug(): string {
      return this.$route.params.slug as string;
    },
    filteredDefinitions(): RecurringDefinition[] {
      return this.definitions.filter((d) => {
        if (this.formatTypeFilter && d.formatType !== this.formatTypeFilter) return false;
        if (!this.includeInactive && !d.isActive) return false;
        return true;
      });
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
        const [defResp, ftResp] = await Promise.all([
          apiGet<{ definitions: RecurringDefinition[] }>(
            `/projects/${this.slug}/recurring-content/definitions?includeInactive=true`,
          ),
          apiGet<{ formatTypes: FormatTypeInfo[] }>(
            `/projects/${this.slug}/recurring-content/definitions/format-types`,
          ),
        ]);
        this.definitions = defResp.definitions;
        this.formatTypes = ftResp.formatTypes;
      } catch (err) {
        this.loadError = true;
        // biome-ignore lint/suspicious/noConsoleLog: dev diagnostic
        if (import.meta.env.DEV) console.warn("[recurring-defs] load failed", err);
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

    openCreate(): void {
      // Spec 65.V1.5b — new definitions go through the multi-page wizard.
      // The legacy single-page modal is still wired for EDIT (openEdit) so
      // existing rows can be tweaked inline; CREATE always uses the wizard.
      void this.$router.push({
        name: "wizard-step-format-type",
        params: { slug: this.slug },
      });
    },

    openDetail(id: string): void {
      void this.$router.push({
        path: `/projects/${this.slug}/settings/recurring-content/${id}`,
      });
    },

    closeEditor(): void {
      this.editorOpen = false;
      this.editing = null;
    },

    onSaved(): void {
      this.closeEditor();
      void this.loadAll();
    },
  },
});
</script>

<style scoped>
.rc-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-bottom: 48px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.header-titles {
  flex: 1;
}
.page-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.page-description {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}
.filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.filter-label {
  color: var(--text-secondary);
}
.select-input {
  background: var(--bg-glass-strong);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  font-size: 13px;
}

.state-banner {
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: var(--bg-glass-strong);
  color: var(--text-secondary);
  font-size: 13px;
}
.state-banner.error {
  background: var(--bg-glass-strong);
  color: var(--color-danger, #e44);
}

.def-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.def-table th,
.def-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
}
.def-table th {
  color: var(--text-tertiary);
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.def-table tbody tr {
  cursor: pointer;
  transition: background 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
@media (hover: hover) and (pointer: fine) {
  .def-table tbody tr:hover {
    background: var(--bg-glass-strong);
  }
}
.def-table tbody tr.inactive {
  opacity: 0.5;
}
.def-name {
  font-weight: 500;
  color: var(--text-primary);
}
.mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
}

.chip-active {
  color: var(--color-success, #4ade80);
  font-size: 16px;
}
.chip-inactive {
  background: var(--bg-glass-strong);
  color: var(--text-tertiary);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
}
.row-actions {
  text-align: right;
  width: 80px;
}
</style>
