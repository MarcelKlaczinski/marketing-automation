<template>
  <PhaseShell
    :current-phase="1"
    :title="$t('coldStart.phases.basics.title') as string"
    :description="$t('coldStart.phases.basics.description') as string"
    :can-go-back="false"
    :can-advance="isValid"
    :busy="busy"
    @advance="onAdvance"
  >
    <FormField
      :label="$t('coldStart.phases.basics.fields.name') as string"
      required
    >
      <FormInput
        v-model="form.name"
        :placeholder="$t('coldStart.phases.basics.placeholders.name') as string"
        :enable-autocomplete="true"
        autocomplete="organization"
      />
    </FormField>

    <FormField
      :label="$t('coldStart.phases.basics.fields.domain') as string"
      :helper="$t('coldStart.phases.basics.fields.domainHelper') as string"
    >
      <FormInput
        v-model="form.domain"
        :placeholder="$t('coldStart.phases.basics.placeholders.domain') as string"
        autocomplete="url"
        inputmode="url"
      />
    </FormField>

    <FormField :label="$t('coldStart.phases.basics.fields.industry') as string">
      <FormInput
        v-model="form.industry"
        :placeholder="$t('coldStart.phases.basics.placeholders.industry') as string"
      />
    </FormField>

    <FormField :label="$t('coldStart.phases.basics.fields.targetLocales') as string">
      <div class="locale-options">
        <label
          v-for="option in localeOptions"
          :key="option.value"
          class="locale-option"
          :class="{ 'option-selected': form.targetLocales.includes(option.value) }"
        >
          <input
            type="checkbox"
            class="locale-checkbox"
            :checked="form.targetLocales.includes(option.value)"
            @change="onToggleLocale(option.value)"
          />
          <span class="option-flag" aria-hidden="true">{{ option.flag }}</span>
          <span class="option-label">{{ $t(option.labelKey) as string }}</span>
        </label>
      </div>
    </FormField>

    <FormField
      :label="$t('coldStart.phases.basics.fields.marketingContext') as string"
      :helper="$t('coldStart.phases.basics.fields.marketingContextHelper') as string"
    >
      <FormTextarea
        v-model="form.marketingContext"
        :placeholder="$t('coldStart.phases.basics.placeholders.marketingContext') as string"
        :rows="5"
      />
    </FormField>
  </PhaseShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useColdStartDraft } from "src/composables/useColdStartDraft";
import PhaseShell from "src/components/cold-start/PhaseShell.vue";
import FormField from "src/components/forms/FormField.vue";
import FormInput from "src/components/forms/FormInput.vue";
import FormTextarea from "src/components/forms/FormTextarea.vue";

export default defineComponent({
  name: "ColdStartPhase1Basics",

  components: { PhaseShell, FormField, FormInput, FormTextarea },

  setup() {
    return useColdStartDraft();
  },

  data: () => ({
    form: {
      name: "",
      domain: "",
      industry: "",
      targetLocales: ["de"] as string[],
      marketingContext: "",
    },
    busy: false,
  }),

  computed: {
    isValid(): boolean {
      return this.form.name.trim().length >= 2 && this.form.targetLocales.length > 0;
    },
    localeOptions() {
      return [
        { value: "de", flag: "🇩🇪", labelKey: "coldStart.locales.de" },
        { value: "en", flag: "🇬🇧", labelKey: "coldStart.locales.en" },
      ];
    },
  },

  watch: {
    draft: {
      immediate: true,
      handler(newDraft) {
        if (newDraft) {
          this.form.name = newDraft.name ?? "";
          this.form.domain = newDraft.domain ?? "";
          this.form.industry = newDraft.industry ?? "";
          this.form.targetLocales =
            newDraft.targetLocales?.length ? newDraft.targetLocales : ["de"];
          this.form.marketingContext = newDraft.marketingContextMd ?? "";
        }
      },
    },
  },

  methods: {
    onToggleLocale(locale: string): void {
      const idx = this.form.targetLocales.indexOf(locale);
      if (idx >= 0) {
        this.form.targetLocales.splice(idx, 1);
      } else {
        this.form.targetLocales.push(locale);
      }
    },
    async onAdvance(): Promise<void> {
      if (!this.isValid) return;
      this.busy = true;
      try {
        const updates: Record<string, unknown> = {
          name: this.form.name,
          targetLocales: this.form.targetLocales,
        };
        if (this.form.domain) updates["domain"] = this.form.domain;
        if (this.form.industry) updates["industry"] = this.form.industry;
        if (this.form.marketingContext) updates["marketingContextMd"] = this.form.marketingContext;

        await this.updateDraft(updates);
        await this.advance();
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : (this.$t("errors.generic") as string),
        });
      } finally {
        this.busy = false;
      }
    },
  },
});
</script>

<style scoped>
.locale-options {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.locale-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-glass);
  cursor: pointer;
  transition: background 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1)),
              border-color 150ms var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
  user-select: none;
}

@media (hover: hover) and (pointer: fine) {
  .locale-option:hover {
    background: var(--bg-glass-hover);
    border-color: var(--border-medium);
  }
}

.locale-option.option-selected {
  border-color: var(--accent-primary);
  background: rgba(124, 92, 255, 0.08);
}

.locale-checkbox {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.option-flag {
  font-size: 18px;
  line-height: 1;
}

.option-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}
</style>
