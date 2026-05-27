<template>
  <WizardStepShell
    :step-number="2"
    :title="$t('recurringContent.wizard.config.title') as string"
    :description="configDescription"
    :can-advance="!nameMissing"
    @back="onBack"
    @advance="onAdvance"
  >
    <label class="field">
      <span class="label">{{ $t("recurringContent.wizard.config.nameLabel") as string }}</span>
      <input
        v-model="name"
        type="text"
        class="text-input"
        maxlength="120"
        :placeholder="$t('recurringContent.wizard.config.namePlaceholder') as string"
        @input="persistName"
      />
      <small v-if="nameMissing" class="hint hint-error">
        {{ $t("recurringContent.wizard.config.nameRequired") as string }}
      </small>
    </label>

    <!--
      Spec 65.V1.5c — dispatch to the matching per-format form by format-type.
      Each form binds to a `Record<string, unknown>` slice of the wizard draft
      via v-model and emits a normalized payload (only declared fields, no
      undefined leaks). The JSON-editor branch is the fallback for unknown
      format-types — registered types fall straight through to their form.
    -->
    <component
      :is="formComponent"
      v-if="formComponent"
      :model-value="formConfig"
      @update:model-value="onFormUpdate"
    />

    <!-- Fallback: raw JSON editor (unknown format-type or developer-mode). -->
    <div v-else class="config-form">
      <p class="config-hint">{{ $t("recurringContent.wizard.config.editorHint") as string }}</p>
      <textarea
        v-model="configJson"
        class="config-editor"
        spellcheck="false"
        :placeholder="schemaSample"
        @blur="persistConfig"
      />
      <small v-if="parseError" class="hint hint-error">{{ parseError }}</small>
    </div>
  </WizardStepShell>
</template>

<script lang="ts">
import { defineComponent, type Component } from "vue";
import WizardStepShell from "src/components/settings/recurring-content/wizard/WizardStepShell.vue";
import TopNComparisonForm from "src/components/settings/recurring-content/forms/TopNComparisonForm.vue";
import HeadToHeadForm from "src/components/settings/recurring-content/forms/HeadToHeadForm.vue";
import StoryArcClickbaitForm from "src/components/settings/recurring-content/forms/StoryArcClickbaitForm.vue";
import LifestyleListicleForm from "src/components/settings/recurring-content/forms/LifestyleListicleForm.vue";
import OpinionRecommendationForm from "src/components/settings/recurring-content/forms/OpinionRecommendationForm.vue";
import { useRecurringWizardDraftStore } from "src/stores/recurring-wizard-draft";

/**
 * Per-format form registry. Adding a new format-type to FORMAT_TYPES on the
 * shared package requires one entry here too — TypeScript catches missing
 * keys against the format-type union when the registry widens.
 */
const FORM_REGISTRY: Record<string, Component> = {
  top_n_comparison: TopNComparisonForm,
  head_to_head: HeadToHeadForm,
  story_arc_clickbait: StoryArcClickbaitForm,
  lifestyle_listicle: LifestyleListicleForm,
  opinion_recommendation: OpinionRecommendationForm,
};

const SCHEMA_SAMPLES: Record<string, string> = {
  top_n_comparison: '{\n  "topN": 5,\n  "categorySlug": null\n}',
  head_to_head: '{\n  "toolAId": "uuid",\n  "toolBId": "uuid"\n}',
  story_arc_clickbait: '{\n  "professionPool": ["copywriter", "designer"]\n}',
  lifestyle_listicle: '{\n  "lifeArea": "productivity",\n  "itemCount": 5\n}',
  opinion_recommendation: '{\n  "recommendedToolId": "uuid"\n}',
};

export default defineComponent({
  name: "StepConfigPage",

  components: {
    WizardStepShell,
    TopNComparisonForm,
    HeadToHeadForm,
    StoryArcClickbaitForm,
    LifestyleListicleForm,
    OpinionRecommendationForm,
  },

  data: () => ({
    name: "",
    configJson: "{}",
    parseError: "",
  }),

  computed: {
    slug(): string {
      const v = this.$route.params.slug;
      return Array.isArray(v) ? (v[0] ?? "") : v ?? "";
    },
    store() {
      return useRecurringWizardDraftStore();
    },
    formatTypeKey(): string {
      return this.store.draft.formatType ?? "";
    },
    formComponent(): Component | null {
      return FORM_REGISTRY[this.formatTypeKey] ?? null;
    },
    formConfig(): Record<string, unknown> {
      return this.store.draft.formatConfig ?? {};
    },
    configDescription(): string {
      if (!this.formatTypeKey) {
        return this.$t("recurringContent.wizard.config.noFormatType") as string;
      }
      const typed = this.$t(
        `recurringContent.wizard.config.descriptions.${this.formatTypeKey}`,
        "",
      ) as string;
      return typed || (this.$t("recurringContent.wizard.config.descriptionFallback") as string);
    },
    schemaSample(): string {
      return SCHEMA_SAMPLES[this.formatTypeKey] ?? "{}";
    },
    nameMissing(): boolean {
      return this.name.trim().length === 0;
    },
  },

  mounted() {
    if (!this.formatTypeKey) {
      // Re-route to step 1 if user landed here without selecting a format.
      void this.$router.replace({ name: "wizard-step-format-type", params: { slug: this.slug } });
      return;
    }
    this.store.markStepReached(1);
    this.name = this.store.draft.name;
    this.configJson = JSON.stringify(this.store.draft.formatConfig ?? {}, null, 2);
  },

  methods: {
    persistName(): void {
      this.store.patchDraft({ name: this.name });
    },

    /**
     * Called by the dispatched per-format form on every field change. The
     * payload is already normalized (only declared fields). We persist it
     * directly into the draft's `formatConfig`.
     */
    onFormUpdate(next: Record<string, unknown>): void {
      this.store.patchDraft({ formatConfig: next });
    },

    persistConfig(): void {
      // JSON-editor fallback branch only.
      this.parseError = "";
      try {
        const parsed = JSON.parse(this.configJson || "{}");
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          this.parseError = this.$t("recurringContent.wizard.config.notAnObject") as string;
          return;
        }
        // Safe cast: the type-guard above narrows `parsed` to a plain object;
        // the store accepts arbitrary keys because per-format-type Zod
        // validation happens server-side via validateFormatConfig.
        this.store.patchDraft({ formatConfig: parsed as Record<string, unknown> });
      } catch (err) {
        this.parseError = err instanceof Error
          ? err.message
          : (this.$t("recurringContent.wizard.config.invalidJson") as string);
      }
    },

    onBack(): void {
      this.persistName();
      if (!this.formComponent) this.persistConfig();
      void this.$router.push({ name: "wizard-step-format-type", params: { slug: this.slug } });
    },

    onAdvance(): void {
      this.persistName();
      // Per-format form persists on every field change via onFormUpdate; the
      // JSON editor only persists on blur, so we trigger it before advance.
      if (!this.formComponent) {
        this.persistConfig();
        if (this.parseError) return;
      }
      if (this.nameMissing) return;
      this.store.markStepReached(2);
      void this.$router.push({ name: "wizard-step-schedule", params: { slug: this.slug } });
    },
  },
});
</script>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 18px;
}
.label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
.text-input {
  background: var(--surface-strong);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--text-primary);
  font: inherit;
}
.text-input:focus {
  outline: none;
  border-color: var(--brand-primary);
}
.hint {
  font-size: 12px;
  color: var(--text-tertiary);
}
.hint-error {
  color: var(--text-error);
}

.config-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.config-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.config-editor {
  background: var(--surface-strong);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  padding: 10px;
  color: var(--text-primary);
  font-family: ui-monospace, "JetBrains Mono", "Menlo", monospace;
  font-size: 13px;
  min-height: 160px;
  resize: vertical;
}
.config-editor:focus {
  outline: none;
  border-color: var(--brand-primary);
}
</style>
