<template>
  <div class="generate-tab">
    <GlassCard variant="strong" class="generate-form">
      <header class="form-header">
        <h2 class="form-title">{{ $t("articleTools.generate.title") as string }}</h2>
        <p class="form-description">{{ $t("articleTools.generate.description") as string }}</p>
      </header>

      <FormField
        :label="$t('articleTools.generate.fields.topic') as string"
        :helper="$t('articleTools.generate.fields.topicHelper') as string"
        :required="true"
        :error="errors.topic ?? ''"
      >
        <FormInput
          v-model="form.topic"
          :placeholder="$t('articleTools.generate.placeholders.topic') as string"
        />
      </FormField>

      <FormField
        :label="$t('articleTools.generate.fields.primaryKeyword') as string"
        :required="true"
        :error="errors.primaryKeyword ?? ''"
      >
        <FormInput
          v-model="form.primaryKeyword"
          :placeholder="$t('articleTools.generate.placeholders.primaryKeyword') as string"
        />
      </FormField>

      <div class="form-row">
        <FormField :label="$t('articleTools.generate.fields.collection') as string">
          <FormSelect v-model="form.collection">
            <option v-for="col in collectionOptions" :key="col" :value="col">
              {{ $t(`articles.filters.collections.${col}`) as string }}
            </option>
          </FormSelect>
        </FormField>

        <FormField :label="$t('articleTools.generate.fields.locale') as string">
          <FormSelect v-model="form.locale">
            <option v-for="loc in localeOptions" :key="loc" :value="loc">
              {{ $t(`articles.filters.locales.${loc}`) as string }}
            </option>
          </FormSelect>
        </FormField>

        <FormField :label="$t('articleTools.generate.fields.intentType') as string">
          <FormSelect v-model="form.intentType">
            <option v-for="intent in intentOptions" :key="intent" :value="intent">
              {{ $t(`articleTools.intents.${intent}`) as string }}
            </option>
          </FormSelect>
        </FormField>
      </div>

      <FormField
        v-if="form.collection === 'comparisons'"
        :label="$t('articleTools.generate.fields.toolSlugs') as string"
        :helper="$t('articleTools.generate.fields.toolSlugsHelper') as string"
        :required="true"
        :error="errors.toolSlugs ?? ''"
      >
        <div class="tool-picker">
          <label
            v-for="tool in availableTools"
            :key="tool.slug"
            class="tool-option"
            :class="{ selected: selectedToolSlugs.includes(tool.slug), disabled: !selectedToolSlugs.includes(tool.slug) && selectedToolSlugs.length >= 4 }"
          >
            <input
              type="checkbox"
              :value="tool.slug"
              :checked="selectedToolSlugs.includes(tool.slug)"
              :disabled="!selectedToolSlugs.includes(tool.slug) && selectedToolSlugs.length >= 4"
              @change="onToolToggle(tool.slug)"
            />
            <span class="tool-name">{{ tool.title || tool.slug }}</span>
            <span class="tool-slug mono">{{ tool.slug }}</span>
          </label>
          <p v-if="!availableTools.length && !toolsLoading" class="tool-empty">
            {{ $t("articleTools.generate.fields.toolSlugsEmpty") as string }}
          </p>
          <p v-if="toolsLoading" class="tool-empty">{{ $t("forms.loading") as string }}</p>
        </div>
      </FormField>

      <FormField
        :label="$t('articleTools.generate.fields.author') as string"
        :helper="$t('articleTools.generate.fields.authorHelper') as string"
      >
        <AuthorPicker v-model="form.authorSlug" />
      </FormField>

      <FormField
        :label="$t('articleTools.generate.fields.cluster') as string"
        :helper="$t('articleTools.generate.fields.clusterHelper') as string"
      >
        <ClusterPicker v-model="form.clusterId" />
      </FormField>

      <FormField :label="$t('articleTools.generate.fields.wordCount') as string">
        <FormInput
          :model-value="form.estimatedWordCount"
          type="number"
          inputmode="numeric"
          @update:model-value="(v: string) => { form.estimatedWordCount = v; }"
        />
      </FormField>

      <div class="form-summary">
        <div class="estimate-row">
          <span>{{ $t("articleTools.generate.estimatedCost") as string }}:</span>
          <span class="mono">€{{ estimatedCost.toFixed(2) }}</span>
        </div>
        <div class="estimate-row">
          <span>{{ $t("articleTools.generate.estimatedTime") as string }}:</span>
          <span class="mono">~{{ estimatedMinutes }} min</span>
        </div>
      </div>

      <div class="form-actions">
        <GlassButton
          variant="primary"
          :disabled="!isFormValid || generating"
          :loading="generating"
          @click="onGenerate"
        >
          {{ $t("articleTools.generate.submit") as string }}
        </GlassButton>
      </div>
    </GlassCard>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import GlassCard from "src/components/ui/GlassCard.vue";
import GlassButton from "src/components/ui/GlassButton.vue";
import FormField from "src/components/forms/FormField.vue";
import FormInput from "src/components/forms/FormInput.vue";
import FormSelect from "src/components/forms/FormSelect.vue";
import AuthorPicker from "src/components/article-tools/AuthorPicker.vue";
import ClusterPicker from "src/components/article-tools/ClusterPicker.vue";
import { apiGet, apiPost } from "src/lib/api";

interface GenerateResponse {
  articleId: string;
  briefId: string;
  runId: string;
}

interface ToolOption {
  slug: string;
  title: string;
}

export default defineComponent({
  name: "ArticleGenerateTab",

  components: { GlassCard, GlassButton, FormField, FormInput, FormSelect, AuthorPicker, ClusterPicker },

  data: () => ({
    form: {
      topic: "",
      primaryKeyword: "",
      collection: "blog",
      locale: "de",
      intentType: "general",
      authorSlug: "",
      clusterId: "",
      estimatedWordCount: "2000",
    },
    errors: {} as Record<string, string>,
    generating: false,
    selectedToolSlugs: [] as string[],
    availableTools: [] as ToolOption[],
    toolsLoading: false,
  }),

  computed: {
    collectionOptions(): string[] {
      return ["blog", "tools", "comparisons", "ki-wissen", "usecases", "tool-categories"];
    },

    localeOptions(): string[] {
      return ["de", "en"];
    },

    intentOptions(): string[] {
      return ["overview", "general", "review", "comparison", "pricing", "tutorial", "use-cases", "features"];
    },

    isFormValid(): boolean {
      const base = this.form.topic.length >= 5 && this.form.primaryKeyword.length >= 2;
      if (!base) return false;
      if (this.form.collection === "comparisons") {
        return this.selectedToolSlugs.length >= 2 && this.selectedToolSlugs.length <= 4;
      }
      return true;
    },

    estimatedCost(): number {
      const baseCost = 0.39;
      const wordCount = parseInt(this.form.estimatedWordCount, 10) || 2000;
      return baseCost * (wordCount / 2000);
    },

    estimatedMinutes(): number {
      const wordCount = parseInt(this.form.estimatedWordCount, 10) || 2000;
      return Math.ceil(3 + (wordCount / 2000) * 2);
    },
  },

  watch: {
    "form.collection"(next: string): void {
      // Reset tool selection if user switched away from comparisons
      if (next !== "comparisons") {
        this.selectedToolSlugs = [];
        return;
      }
      void this.fetchTools();
    },
  },

  methods: {
    onToolToggle(slug: string): void {
      const idx = this.selectedToolSlugs.indexOf(slug);
      if (idx >= 0) {
        this.selectedToolSlugs.splice(idx, 1);
      } else if (this.selectedToolSlugs.length < 4) {
        this.selectedToolSlugs.push(slug);
      }
    },

    async fetchTools(): Promise<void> {
      if (this.availableTools.length || this.toolsLoading) return;
      this.toolsLoading = true;
      try {
        const slug = this.$route.params.slug as string;
        const data = await apiGet<{ items: ToolOption[] }>(
          `/projects/${slug}/articles?collection=tools&limit=100&locale=${this.form.locale}`,
        );
        this.availableTools = (data.items ?? [])
          .filter((t) => typeof t.slug === "string" && t.slug.length > 0)
          .map((t) => ({ slug: t.slug, title: t.title ?? t.slug }))
          .sort((a, b) => a.title.localeCompare(b.title));
      } catch {
        this.availableTools = [];
      } finally {
        this.toolsLoading = false;
      }
    },

    async onGenerate(): Promise<void> {
      if (!this.isFormValid) return;

      this.errors = {};
      const wordCount = parseInt(this.form.estimatedWordCount, 10) || 2000;
      const slug = this.$route.params.slug as string;

      const payload: Record<string, unknown> = {
        topic: this.form.topic,
        primaryKeyword: this.form.primaryKeyword,
        collection: this.form.collection,
        locale: this.form.locale,
        intentType: this.form.intentType,
        estimatedWordCount: wordCount,
      };
      if (this.form.authorSlug) payload.authorSlug = this.form.authorSlug;
      if (this.form.clusterId) payload.clusterId = this.form.clusterId;
      if (this.form.collection === "comparisons" && this.selectedToolSlugs.length) {
        payload.toolSlugs = this.selectedToolSlugs;
      }

      this.generating = true;
      try {
        const response = await apiPost<GenerateResponse>(
          `/projects/${slug}/articles/generate-standalone`,
          payload,
        );

        this.$q.notify({ type: "positive", message: this.$t("articleTools.generate.successMessage") as string });
        void this.$router.push(`/projects/${slug}/articles/${response.articleId}`);
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : (this.$t("articleTools.generate.errorMessage") as string),
        });
      } finally {
        this.generating = false;
      }
    },
  },
});
</script>

<style scoped>
.generate-tab {
  padding: 24px 32px;
  overflow-y: auto;
  flex: 1;
}

.generate-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 640px;
  padding: 20px;
}

.form-header {
  margin-bottom: 4px;
}

.form-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.form-description {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

@media (max-width: 600px) {
  .form-row {
    grid-template-columns: 1fr;
  }
}

.form-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: var(--surface-secondary, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

.estimate-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
}

.tool-picker {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--surface-secondary, rgba(255, 255, 255, 0.03));
}

.tool-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  min-height: 44px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  border: 1px solid transparent;
  transition: background-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              border-color 160ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}

@media (hover: hover) and (pointer: fine) {
  .tool-option:hover:not(.disabled) {
    background: var(--surface-tertiary, rgba(255, 255, 255, 0.05));
  }
}

.tool-option.selected {
  background: color-mix(in oklch, var(--brand) 12%, transparent);
  border-color: color-mix(in oklch, var(--brand) 35%, transparent);
}

.tool-option.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.tool-option input[type="checkbox"] {
  cursor: inherit;
}

.tool-name {
  flex: 1;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-slug {
  font-size: 11px;
  color: var(--text-tertiary);
}

.tool-empty {
  grid-column: 1 / -1;
  margin: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: center;
}
</style>
