<template>
  <div class="template-suggestions-panel">
    <div v-if="loading" class="template-suggestions-panel__loading">
      <q-spinner size="32px" color="primary" />
    </div>

    <div v-else-if="suggestions.length === 0" class="template-suggestions-panel__empty">
      {{ $t('articles.templateSuggestions.empty') }}
    </div>

    <div v-else class="template-suggestions-panel__content">
      <div class="template-suggestions-panel__list">
        <div
          v-for="s in suggestions"
          :key="s.templateKey"
          class="suggestion-item"
        >
          <div class="suggestion-item__row">
            <q-chip
              :outline="!selections[s.templateKey]"
              :color="selections[s.templateKey] ? 'primary' : undefined"
              :text-color="selections[s.templateKey] ? 'white' : undefined"
              clickable
              @click="toggleSelection(s.templateKey)"
              class="suggestion-item__chip"
            >
              {{ formatTemplateName(s.templateKey) }}
            </q-chip>

            <q-badge
              color="blue-grey-6"
              class="suggestion-item__confidence"
            >
              {{ Math.round(s.confidence * 100) }}%
            </q-badge>

            <q-badge
              v-if="renders[s.templateKey]"
              :color="renderStatusColor(renders[s.templateKey]!)"
              class="suggestion-item__render-status"
            >
              {{ $t(`articles.templateSuggestions.status.${renders[s.templateKey]}`, renders[s.templateKey]!) }}
            </q-badge>
          </div>
        </div>
      </div>

      <div class="suggestion-actions">
        <q-btn
          flat
          dense
          size="sm"
          :label="$t('articles.templateSuggestions.generateAll')"
          :loading="generating"
          @click="generateAll"
        />
        <q-btn
          unelevated
          dense
          size="sm"
          color="primary"
          :label="$t('articles.templateSuggestions.generateSelected')"
          :disable="selectedKeys.length === 0 || generating"
          :loading="generating"
          @click="generateSelected"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { api } from "../../lib/api-client";

interface TemplateSuggestion {
  templateKey: string;
  confidence: number;
}

interface TemplateRenderStatus {
  [templateKey: string]: string;
}

export default defineComponent({
  name: "TemplateSuggestionsPanel",

  props: {
    articleId: {
      type: String as PropType<string>,
      required: true,
    },
  },

  emits: ["suggestions-loaded"],

  data: () => ({
    loading: false,
    generating: false,
    suggestions: [] as TemplateSuggestion[],
    renders: {} as TemplateRenderStatus,
    selections: {} as Record<string, boolean>,
  }),

  computed: {
    selectedKeys(): string[] {
      return Object.entries(this.selections)
        .filter(([, v]) => v)
        .map(([k]) => k);
    },
  },

  mounted() {
    this.loadSuggestions();
  },

  methods: {
    async loadSuggestions() {
      this.loading = true;
      try {
        const res = await api.get<{
          ok: boolean;
          data: { suggestions: TemplateSuggestion[]; renders: TemplateRenderStatus };
        }>(`/articles/${this.articleId}/template-suggestions`);
        if (res.data.ok) {
          this.suggestions = res.data.data.suggestions;
          this.renders = res.data.data.renders;
          this.$emit("suggestions-loaded", this.suggestions.length);
        }
      } catch {
        // silently ignore
      } finally {
        this.loading = false;
      }
    },

    toggleSelection(templateKey: string) {
      this.selections = {
        ...this.selections,
        [templateKey]: !this.selections[templateKey],
      };
    },

    async generateAll() {
      const keys = this.suggestions.map((s) => s.templateKey);
      await this.triggerGeneration(keys);
    },

    async generateSelected() {
      await this.triggerGeneration(this.selectedKeys);
    },

    async triggerGeneration(templateKeys: string[]) {
      if (templateKeys.length === 0) return;
      this.generating = true;
      try {
        const res = await api.post<{ ok: boolean; data: { jobs: Array<{ status: string }> } }>(
          `/articles/${this.articleId}/generate-templates`,
          { templateKeys, locale: "de", theme: "dark" }
        );
        if (res.data.ok) {
          const queued = res.data.data.jobs.filter((j) => j.status === "queued").length;
          this.$q.notify({
            message: (this.$t("articles.templateSuggestions.queued", { n: queued }) as string),
            color: "positive",
            timeout: 3000,
          });
          await this.loadSuggestions();
          this.selections = {};
        }
      } catch {
        // error surfaces via interceptor
      } finally {
        this.generating = false;
      }
    },

    formatTemplateName(key: string): string {
      return key
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    },

    renderStatusColor(status: string): string {
      if (status === "ready") return "positive";
      if (status === "rendering" || status === "pending") return "warning";
      if (status === "failed") return "negative";
      return "grey";
    },
  },
});
</script>

<style scoped>
.template-suggestions-panel {
  padding: 4px 0;
}

.template-suggestions-panel__loading {
  display: flex;
  justify-content: center;
  padding: 32px;
}

.template-suggestions-panel__empty {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: var(--q-secondary);
  font-style: italic;
}

.template-suggestions-panel__content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.template-suggestions-panel__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.suggestion-item__row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.suggestion-item__chip {
  margin: 0;
}

.suggestion-item__confidence {
  font-size: 11px;
}

.suggestion-item__render-status {
  font-size: 11px;
  text-transform: uppercase;
}

.suggestion-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
