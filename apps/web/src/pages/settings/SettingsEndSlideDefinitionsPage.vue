<template>
  <div class="es-page">
    <header class="page-header">
      <div class="header-titles">
        <h1 class="page-title">{{ $t("recurringContent.endSlides.title") as string }}</h1>
        <p class="page-description">
          {{ $t("recurringContent.endSlides.description") as string }}
        </p>
      </div>
      <q-btn
        color="primary"
        icon="add"
        :label="$t('recurringContent.endSlides.addEndSlide') as string"
        @click="openCreate"
      />
    </header>

    <div v-if="loadError" class="state-banner error">
      {{ $t("recurringContent.definitions.loadError") as string }}
    </div>
    <div v-else-if="loading" class="state-banner">{{ $t("common.loading") as string }}</div>
    <div v-else-if="endSlides.length === 0" class="state-banner">
      {{ $t("recurringContent.endSlides.empty") as string }}
    </div>

    <table v-else class="es-table">
      <thead>
        <tr>
          <th>{{ $t("recurringContent.endSlides.columns.name") as string }}</th>
          <th>{{ $t("recurringContent.endSlides.columns.type") as string }}</th>
          <th>{{ $t("recurringContent.endSlides.columns.active") as string }}</th>
          <th class="row-actions" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="es in endSlides" :key="es.id" :class="{ inactive: !es.isActive }">
          <td class="es-name">{{ es.name }}</td>
          <td>
            <span class="type-chip mono">
              {{ typeLabel(es.type) }}
            </span>
          </td>
          <td>
            <span v-if="es.isActive" class="chip-active">●</span>
            <span v-else class="chip-inactive">
              {{ $t("recurringContent.endSlides.inactiveChip") as string }}
            </span>
          </td>
          <td class="row-actions">
            <q-btn flat size="sm" icon="edit" @click="openEdit(es)" />
            <q-btn
              flat
              size="sm"
              :icon="es.isActive ? 'pause' : 'play_arrow'"
              @click="toggleActive(es)"
            />
          </td>
        </tr>
      </tbody>
    </table>

    <EndSlideEditModal
      v-if="editorOpen"
      :slug="slug"
      :end-slide="editing"
      @close="closeEditor"
      @saved="onSaved"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { apiGet, apiPatch } from "src/lib/api";
import EndSlideEditModal from "src/components/settings/recurring-content/EndSlideEditModal.vue";

interface EndSlideDef {
  id: string;
  projectId: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

export default defineComponent({
  name: "SettingsEndSlideDefinitionsPage",
  components: { EndSlideEditModal },

  data: () => ({
    endSlides: [] as EndSlideDef[],
    loading: true,
    loadError: false,
    editorOpen: false,
    editing: null as EndSlideDef | null,
  }),

  computed: {
    slug(): string {
      return this.$route.params.slug as string;
    },
  },

  mounted() {
    void this.load();
  },

  methods: {
    async load(): Promise<void> {
      this.loading = true;
      this.loadError = false;
      try {
        const data = await apiGet<{ endSlides: EndSlideDef[] }>(
          `/projects/${this.slug}/end-slides?includeInactive=true`,
        );
        this.endSlides = data.endSlides;
      } catch (err) {
        this.loadError = true;
        // biome-ignore lint/suspicious/noConsoleLog: dev diagnostic
        if (import.meta.env.DEV) console.warn("[end-slides] load", err);
      } finally {
        this.loading = false;
      }
    },

    typeLabel(type: string): string {
      const label = this.$t(`recurringContent.endSlides.typeLabel.${type}`);
      return typeof label === "string" && !label.startsWith("recurringContent.")
        ? label
        : type;
    },

    openCreate(): void {
      this.editing = null;
      this.editorOpen = true;
    },
    openEdit(es: EndSlideDef): void {
      this.editing = es;
      this.editorOpen = true;
    },
    closeEditor(): void {
      this.editorOpen = false;
      this.editing = null;
    },
    onSaved(): void {
      this.closeEditor();
      void this.load();
    },

    async toggleActive(es: EndSlideDef): Promise<void> {
      try {
        await apiPatch(`/projects/${this.slug}/end-slides/${es.id}/active`, {
          isActive: !es.isActive,
        });
        await this.load();
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
.es-page { display: flex; flex-direction: column; gap: 18px; padding-bottom: 48px; }
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.header-titles { flex: 1; }
.page-title { margin: 0; font-size: 22px; font-weight: 600; }
.page-description { margin: 4px 0 0; color: var(--text-secondary); font-size: 13px; }

.state-banner {
  padding: 14px 16px;
  border-radius: var(--radius-md);
  background: var(--bg-glass-strong);
  color: var(--text-secondary);
  font-size: 13px;
}
.state-banner.error { color: var(--color-danger, #e44); }

.es-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.es-table th, .es-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
}
.es-table th {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.es-table tbody tr.inactive { opacity: 0.5; }
.es-name { font-weight: 500; }

.type-chip {
  background: var(--bg-glass-strong);
  border-radius: 999px;
  padding: 2px 8px;
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
.row-actions { text-align: right; width: 90px; }
.mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; }
</style>
