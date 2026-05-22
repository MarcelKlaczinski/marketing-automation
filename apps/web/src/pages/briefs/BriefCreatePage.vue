<!--
  Spec 64.14 Phase C — manual brief creation page.

  Lives as a child route of /projects/:slug/briefs so it inherits the
  master/detail layout shell. The form drives POST /projects/:slug/briefs
  with topic_title, primary_keyword, collection_hint, optional intent_type,
  optional description, and locale. Intent auto-derives from collection when
  the user doesn't pick one explicitly.

  Pattern: Options API, data: () => ({...}), all strings via $t(), error
  handling via $q.notify + apiPost (which throws on non-2xx).
-->
<template>
  <div class="brief-create-page">
    <div class="create-shell">
      <div class="create-header">
        <h1 class="create-title">{{ $t("briefs.create.title") as string }}</h1>
        <p class="create-subtitle">
          {{ $t("briefs.create.subtitle") as string }}
        </p>
      </div>

      <form class="create-form" @submit.prevent="onSubmit">
        <div class="form-row">
          <label class="form-label" for="brief-collection">
            {{ $t("briefs.create.collectionHint") as string }}
          </label>
          <FormSelect
            id="brief-collection"
            v-model="form.collectionHint"
            @update:model-value="onCollectionChange"
          >
            <option
              v-for="col in collectionOptions"
              :key="col"
              :value="col"
            >
              {{ $t(`briefs.collections.${col}`) as string }}
            </option>
          </FormSelect>
          <p class="form-hint">
            {{ $t("briefs.create.collectionHintHelp") as string }}
          </p>
        </div>

        <div class="form-row">
          <label class="form-label" for="brief-intent">
            {{ $t("briefs.create.intentType") as string }}
          </label>
          <FormSelect id="brief-intent" v-model="form.intentType">
            <option
              v-for="intent in intentOptions"
              :key="intent"
              :value="intent"
            >
              {{ $t(`briefs.intents.${intent}`) as string }}
            </option>
          </FormSelect>
          <p class="form-hint">
            {{ $t("briefs.create.intentHint") as string }}
          </p>
        </div>

        <div class="form-row">
          <label class="form-label" for="brief-title">
            {{ $t("briefs.create.topicTitle") as string }}
          </label>
          <FormInput
            id="brief-title"
            v-model="form.topicTitle"
            :placeholder="$t('briefs.create.topicTitlePlaceholder') as string"
            :has-error="titleHasError"
          />
          <p v-if="titleHasError" class="form-error">
            {{ $t("briefs.create.errors.titleTooShort") as string }}
          </p>
        </div>

        <div class="form-row">
          <label class="form-label" for="brief-keyword">
            {{ $t("briefs.create.primaryKeyword") as string }}
          </label>
          <FormInput
            id="brief-keyword"
            v-model="form.primaryKeyword"
            :placeholder="$t('briefs.create.primaryKeywordPlaceholder') as string"
            :has-error="keywordHasError"
          />
          <p v-if="keywordHasError" class="form-error">
            {{ $t("briefs.create.errors.keywordRequired") as string }}
          </p>
        </div>

        <div class="form-row">
          <label class="form-label" for="brief-locale">
            {{ $t("briefs.create.locale") as string }}
          </label>
          <FormSelect id="brief-locale" v-model="form.locale">
            <option
              v-for="loc in localeOptions"
              :key="loc"
              :value="loc"
            >
              {{ $t(`articles.filters.locales.${loc}`) as string }}
            </option>
          </FormSelect>
        </div>

        <div class="form-row">
          <label class="form-label" for="brief-description">
            {{ $t("briefs.create.description") as string }}
          </label>
          <FormTextarea
            id="brief-description"
            v-model="form.description"
            :placeholder="$t('briefs.create.descriptionPlaceholder') as string"
            :rows="3"
          />
        </div>

        <div class="form-actions">
          <GlassButton variant="ghost" type="button" @click="onCancel">
            {{ $t("common.cancel") as string }}
          </GlassButton>
          <GlassButton
            variant="primary"
            type="submit"
            :loading="submitting"
            :disabled="!canSubmit"
          >
            {{
              submitting
                ? ($t("briefs.create.submitting") as string)
                : ($t("briefs.create.submit") as string)
            }}
          </GlassButton>
        </div>
      </form>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { apiPost } from "src/lib/api";
import FormInput from "src/components/forms/FormInput.vue";
import FormSelect from "src/components/forms/FormSelect.vue";
import FormTextarea from "src/components/forms/FormTextarea.vue";
import GlassButton from "src/components/ui/GlassButton.vue";

type CollectionHint = "blog" | "comparison" | "ki-wissen" | "cluster";
type IntentType =
  | "knowledge"
  | "tutorial"
  | "use_case"
  | "comparison"
  | "review"
  | "news"
  | "best_practices"
  | "alternatives"
  | "pricing"
  | "risks";

const COLLECTION_OPTIONS: CollectionHint[] = [
  "ki-wissen",
  "blog",
  "comparison",
  "cluster",
];

const INTENT_OPTIONS: IntentType[] = [
  "knowledge",
  "tutorial",
  "use_case",
  "comparison",
  "review",
  "news",
  "best_practices",
  "alternatives",
  "pricing",
  "risks",
];

// Mirror of the backend deriveIntentFromCollection() helper — keeps the
// auto-fill in sync with the server's default when the user leaves intent
// unset.
const COLLECTION_TO_INTENT: Record<CollectionHint, IntentType> = {
  "ki-wissen": "knowledge",
  comparison: "comparison",
  blog: "use_case",
  cluster: "use_case",
};

export default defineComponent({
  name: "BriefCreatePage",

  components: { FormInput, FormSelect, FormTextarea, GlassButton },

  setup() {
    const queryClient = useQueryClient();
    return { queryClient };
  },

  data: () => ({
    form: {
      topicTitle: "",
      primaryKeyword: "",
      collectionHint: "ki-wissen" as CollectionHint,
      intentType: "knowledge" as IntentType,
      description: "",
      locale: "de" as "de" | "en",
    },
    submitting: false,
    // Inline error display only fires after the user attempted submit once —
    // avoids angry-red on the first focus.
    submitted: false,
  }),

  computed: {
    collectionOptions(): CollectionHint[] {
      return COLLECTION_OPTIONS;
    },
    intentOptions(): IntentType[] {
      return INTENT_OPTIONS;
    },
    localeOptions(): Array<"de" | "en"> {
      return ["de", "en"];
    },
    slug(): string {
      // Route param guaranteed by the parent /projects/:slug route guard.
      const raw = this.$route.params.slug;
      return Array.isArray(raw) ? (raw[0] ?? "") : (raw ?? "");
    },
    titleHasError(): boolean {
      return this.submitted && this.form.topicTitle.trim().length < 10;
    },
    keywordHasError(): boolean {
      return this.submitted && this.form.primaryKeyword.trim().length < 2;
    },
    canSubmit(): boolean {
      return (
        this.form.topicTitle.trim().length >= 10 &&
        this.form.primaryKeyword.trim().length >= 2 &&
        !this.submitting
      );
    },
  },

  methods: {
    onCollectionChange(value: string) {
      // Auto-derive intent_type when the collection changes. The user can
      // still override afterwards.
      const collection = value as CollectionHint;
      this.form.collectionHint = collection;
      this.form.intentType = COLLECTION_TO_INTENT[collection];
    },
    onCancel() {
      void this.$router.push({
        name: "briefs",
        params: { slug: this.slug },
      });
    },
    async onSubmit() {
      this.submitted = true;
      if (!this.canSubmit) return;

      this.submitting = true;
      try {
        const body: Record<string, unknown> = {
          topicTitle: this.form.topicTitle.trim(),
          primaryKeyword: this.form.primaryKeyword.trim(),
          collectionHint: this.form.collectionHint,
          intentType: this.form.intentType,
          locale: this.form.locale,
        };
        const trimmedDescription = this.form.description.trim();
        if (trimmedDescription.length > 0) {
          body.description = trimmedDescription;
        }

        await apiPost(`/projects/${this.slug}/briefs`, body);

        // Invalidate the brief list cache so the new brief shows up
        // immediately in the BriefsPage "pending" section.
        await this.queryClient.invalidateQueries({
          queryKey: ["briefs", this.slug],
        });

        this.$q.notify({
          type: "positive",
          message: this.$t("briefs.create.success", {
            title: this.form.topicTitle.trim(),
          }) as string,
        });
        void this.$router.push({
          name: "briefs",
          params: { slug: this.slug },
        });
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : (this.$t("briefs.create.errors.submitFailed") as string);
        this.$q.notify({ type: "negative", message });
      } finally {
        this.submitting = false;
      }
    },
  },
});
</script>

<style scoped>
.brief-create-page {
  width: 100%;
  padding: 24px;
}

.create-shell {
  max-width: 640px;
  margin: 0 auto;
}

.create-header {
  margin-bottom: 24px;
}

.create-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px;
}

.create-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.create-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.form-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  margin: 0;
}

.form-error {
  font-size: 11px;
  color: var(--status-failed, #ff4d6d);
  margin: 0;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
