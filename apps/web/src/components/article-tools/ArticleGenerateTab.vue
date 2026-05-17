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
import { apiPost } from "src/lib/api";

interface GenerateResponse {
  articleId: string;
  briefId: string;
  runId: string;
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
      return this.form.topic.length >= 5 && this.form.primaryKeyword.length >= 2;
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

  methods: {
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
</style>
