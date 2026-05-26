<template>
  <div class="hook-page">
    <header class="page-header">
      <div class="header-titles">
        <h1 class="page-title">{{ $t("recurringContent.hooks.title") as string }}</h1>
        <p class="page-description">
          {{ $t("recurringContent.hooks.description") as string }}
        </p>
      </div>
      <q-btn
        color="primary"
        icon="add"
        :label="$t('recurringContent.hooks.addHook') as string"
        @click="openCreate"
      />
    </header>

    <section class="filters">
      <label class="filter-row">
        <span class="filter-label">{{ $t("recurringContent.hooks.formatTypeLabel") as string }}</span>
        <select v-model="formatTypeFilter" class="select-input">
          <option v-for="ft in familyBFormatTypes" :key="ft" :value="ft">
            {{ $t(`recurringContent.definitions.formatType.${ft}`) as string }}
          </option>
        </select>
      </label>
      <label class="filter-row">
        <span class="filter-label">{{ $t("recurringContent.hooks.languageLabel") as string }}</span>
        <select v-model="languageFilter" class="select-input">
          <option value="de">{{ $t("recurringContent.hooks.languageDe") as string }}</option>
          <option value="en">{{ $t("recurringContent.hooks.languageEn") as string }}</option>
        </select>
      </label>
    </section>

    <div v-if="loadError" class="state-banner error">
      {{ $t("recurringContent.definitions.loadError") as string }}
    </div>
    <div v-else-if="loading" class="state-banner">{{ $t("common.loading") as string }}</div>
    <div v-else-if="filteredHooks.length === 0" class="state-banner">
      {{ $t("recurringContent.hooks.empty") as string }}
    </div>

    <table v-else class="hook-table">
      <thead>
        <tr>
          <th>{{ $t("recurringContent.hooks.columns.pattern") as string }}</th>
          <th>{{ $t("recurringContent.hooks.columns.variables") as string }}</th>
          <th>{{ $t("recurringContent.hooks.columns.usage") as string }}</th>
          <th>{{ $t("recurringContent.hooks.columns.lastUsed") as string }}</th>
          <th>{{ $t("recurringContent.hooks.columns.active") as string }}</th>
          <th class="row-actions" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="hook in filteredHooks" :key="hook.id" :class="{ inactive: !hook.isActive }">
          <td class="pattern-cell">{{ hook.pattern }}</td>
          <td class="vars-cell">
            <span v-for="v in hook.variables" :key="v" class="var-chip mono">{{ v }}</span>
          </td>
          <td class="mono">{{ hook.usageCount }}</td>
          <td>{{ hook.lastUsedAt ? formatDate(hook.lastUsedAt) : "—" }}</td>
          <td>
            <span v-if="hook.isActive" class="chip-active">●</span>
            <span v-else class="chip-inactive">
              {{ $t("recurringContent.hooks.inactiveChip") as string }}
            </span>
          </td>
          <td class="row-actions">
            <q-btn flat size="sm" icon="edit" @click="openEdit(hook)" />
            <q-btn
              flat
              size="sm"
              :icon="hook.isActive ? 'pause' : 'play_arrow'"
              @click="toggleActive(hook)"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <HookEditModal
      v-if="editorOpen"
      :slug="slug"
      :hook="editing"
      :format-types="familyBFormatTypes"
      :default-format-type="formatTypeFilter"
      :default-language="languageFilter"
      @close="closeEditor"
      @saved="onSaved"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiGet, apiPatch } from "src/lib/api";
import HookEditModal from "src/components/settings/recurring-content/HookEditModal.vue";

interface FormatTypeInfo {
  key: string;
  family: "A" | "B";
  needsHooks: boolean;
}

interface HookTemplate {
  id: string;
  projectId: string;
  formatType: string;
  pattern: string;
  language: "de" | "en";
  variables: string[];
  usageCount: number;
  lastUsedAt: string | null;
  isActive: boolean;
  createdAt: string;
}

export default defineComponent({
  name: "SettingsHookLibraryPage",
  components: { HookEditModal },

  data: () => ({
    hooks: [] as HookTemplate[],
    formatTypes: [] as FormatTypeInfo[],
    loading: true,
    loadError: false,
    formatTypeFilter: "story_arc_clickbait",
    languageFilter: "de" as "de" | "en",
    editorOpen: false,
    editing: null as HookTemplate | null,
  }),

  computed: {
    slug(): string {
      return this.$route.params.slug as string;
    },
    familyBFormatTypes(): string[] {
      // Family B = hook-driven, only these have hooks
      return this.formatTypes.filter((f) => f.needsHooks).map((f) => f.key);
    },
    filteredHooks(): HookTemplate[] {
      return this.hooks.filter(
        (h) =>
          h.formatType === this.formatTypeFilter && h.language === this.languageFilter,
      );
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
        const [ftResp, hookResp] = await Promise.all([
          apiGet<{ formatTypes: FormatTypeInfo[] }>(
            `/projects/${this.slug}/recurring-content/definitions/format-types`,
          ),
          apiGet<{ hooks: HookTemplate[] }>(
            `/projects/${this.slug}/hooks?includeInactive=true`,
          ),
        ]);
        this.formatTypes = ftResp.formatTypes;
        this.hooks = hookResp.hooks;
        // If the default formatTypeFilter doesn't match any Family-B entry,
        // pick the first Family-B format-type so the table populates.
        if (
          !this.familyBFormatTypes.includes(this.formatTypeFilter) &&
          this.familyBFormatTypes.length > 0
        ) {
          this.formatTypeFilter = this.familyBFormatTypes[0]!;
        }
      } catch (err) {
        this.loadError = true;
        // biome-ignore lint/suspicious/noConsoleLog: dev diagnostic
        if (import.meta.env.DEV) console.warn("[hook-library] load", err);
      } finally {
        this.loading = false;
      }
    },

    formatDate(iso: string): string {
      const d = new Date(iso);
      const locale = this.$i18n.locale === "de" ? "de-DE" : "en-US";
      return d.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
    },

    openCreate(): void {
      this.editing = null;
      this.editorOpen = true;
    },

    openEdit(hook: HookTemplate): void {
      this.editing = hook;
      this.editorOpen = true;
    },

    closeEditor(): void {
      this.editorOpen = false;
      this.editing = null;
    },

    onSaved(): void {
      this.closeEditor();
      void this.loadAll();
    },

    async toggleActive(hook: HookTemplate): Promise<void> {
      try {
        await apiPatch(`/projects/${this.slug}/hooks/${hook.id}/active`, {
          isActive: !hook.isActive,
        });
        await this.loadAll();
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : "toggle_failed",
        });
      }
    },
  },
});
</script>

<style scoped>
.hook-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-bottom: 48px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.header-titles { flex: 1; }
.page-title { margin: 0; font-size: 22px; font-weight: 600; }
.page-description { margin: 4px 0 0; color: var(--text-secondary); font-size: 13px; }

.filters { display: flex; gap: 16px; flex-wrap: wrap; }
.filter-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.filter-label { color: var(--text-secondary); }
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
.state-banner.error { color: var(--color-danger, #e44); }

.hook-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.hook-table th, .hook-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
  vertical-align: top;
}
.hook-table th {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.hook-table tbody tr.inactive { opacity: 0.5; }

.pattern-cell {
  max-width: 360px;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  white-space: pre-wrap;
}
.vars-cell { display: flex; gap: 4px; flex-wrap: wrap; }
.var-chip {
  background: var(--bg-glass-strong);
  border: 1px solid var(--border-subtle);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}
.chip-active { color: var(--color-success, #4ade80); }
.chip-inactive {
  background: var(--bg-glass-strong);
  color: var(--text-tertiary);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
}
.row-actions { text-align: right; width: 80px; }
.mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; }
</style>
