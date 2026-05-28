<template>
  <WizardStepShell
    :step-number="3"
    :title="$t('recurringContent.wizard.schedule.title') as string"
    :description="$t('recurringContent.wizard.schedule.description') as string"
    :can-advance="!!frequency"
    @back="onBack"
    @advance="onAdvance"
  >
    <label class="field">
      <span class="label">{{ $t("recurringContent.wizard.schedule.frequency") as string }}</span>
      <select v-model="frequency" class="select-input" @change="persist">
        <option value="weekly">{{ $t("recurringContent.wizard.schedule.frequencyWeekly") as string }}</option>
        <option value="biweekly">{{ $t("recurringContent.wizard.schedule.frequencyBiweekly") as string }}</option>
        <option value="monthly">{{ $t("recurringContent.wizard.schedule.frequencyMonthly") as string }}</option>
        <option value="custom">{{ $t("recurringContent.wizard.schedule.frequencyCustom") as string }}</option>
      </select>
    </label>

    <label v-if="frequency === 'custom'" class="field">
      <span class="label">{{ $t("recurringContent.wizard.schedule.cronLabel") as string }}</span>
      <input
        v-model="cronExpression"
        type="text"
        class="text-input"
        :placeholder="$t('recurringContent.wizard.schedule.cronPlaceholder') as string"
        @blur="persist"
      />
      <small class="hint">{{ $t("recurringContent.wizard.schedule.cronHint") as string }}</small>
    </label>

    <div class="field">
      <span class="label">{{ $t("recurringContent.wizard.schedule.outputTargets") as string }}</span>
      <div class="check-row">
        <label class="check-item">
          <input v-model="targetArticle" type="checkbox" @change="persist" />
          <span>{{ $t("recurringContent.wizard.schedule.outputArticle") as string }}</span>
        </label>
        <label class="check-item">
          <input v-model="targetSocial" type="checkbox" @change="persist" />
          <span>{{ $t("recurringContent.wizard.schedule.outputSocial") as string }}</span>
        </label>
      </div>
      <small v-if="!targetArticle && !targetSocial" class="hint hint-error">
        {{ $t("recurringContent.wizard.schedule.outputRequired") as string }}
      </small>
    </div>

    <div class="field">
      <span class="label">{{ $t("recurringContent.wizard.schedule.locales") as string }}</span>
      <div class="check-row">
        <label class="check-item">
          <input v-model="localeDe" type="checkbox" @change="persist" />
          <span>{{ $t("recurringContent.wizard.schedule.localeDe") as string }}</span>
        </label>
        <label class="check-item">
          <input v-model="localeEn" type="checkbox" @change="persist" />
          <span>{{ $t("recurringContent.wizard.schedule.localeEn") as string }}</span>
        </label>
      </div>
      <small v-if="!localeDe && !localeEn" class="hint hint-error">
        {{ $t("recurringContent.wizard.schedule.localesRequired") as string }}
      </small>
    </div>

    <div class="field">
      <span class="label">{{ $t("recurringContent.wizard.schedule.autoApproveLabel") as string }}</span>
      <div class="radio-stack">
        <label class="radio-item">
          <input
            v-model="autoApproveChoice"
            type="radio"
            value="inherit"
            @change="persist"
          />
          <span>
            {{ $t("recurringContent.wizard.schedule.autoApproveInherit") as string }}
          </span>
        </label>
        <label class="radio-item">
          <input
            v-model="autoApproveChoice"
            type="radio"
            value="on"
            @change="persist"
          />
          <span>{{ $t("recurringContent.wizard.schedule.autoApproveOn") as string }}</span>
        </label>
        <label class="radio-item">
          <input
            v-model="autoApproveChoice"
            type="radio"
            value="off"
            @change="persist"
          />
          <span>{{ $t("recurringContent.wizard.schedule.autoApproveOff") as string }}</span>
        </label>
      </div>
      <small class="hint">{{ $t("recurringContent.wizard.schedule.autoApproveHint") as string }}</small>
    </div>

    <!-- Spec 65.16 — Per-definition image-style preset override. Empty value = inherit project default. -->
    <label class="field">
      <span class="label">
        {{ $t("recurringContent.wizard.schedule.imageStylePresetLabel") as string }}
      </span>
      <select v-model="presetOverrideValue" class="select-input" @change="persist">
        <option value="">
          {{ $t("recurringContent.wizard.schedule.imageStylePresetInherit") as string }}
        </option>
        <option value="dark-neon-grid">
          {{ $t("recurringContent.wizard.schedule.imageStylePresetOptions.dark-neon-grid") as string }}
        </option>
        <option value="light-editorial">
          {{ $t("recurringContent.wizard.schedule.imageStylePresetOptions.light-editorial") as string }}
        </option>
        <option value="blue-tech-gradient">
          {{ $t("recurringContent.wizard.schedule.imageStylePresetOptions.blue-tech-gradient") as string }}
        </option>
      </select>
      <small class="hint">
        {{ $t("recurringContent.wizard.schedule.imageStylePresetHint") as string }}
      </small>
    </label>
  </WizardStepShell>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import WizardStepShell from "src/components/settings/recurring-content/wizard/WizardStepShell.vue";
import { useRecurringWizardDraftStore } from "src/stores/recurring-wizard-draft";

type AutoApproveChoice = "inherit" | "on" | "off";
type PresetOverrideValue = "" | "dark-neon-grid" | "light-editorial" | "blue-tech-gradient";

const KNOWN_PRESETS: Record<string, true> = {
  weekly: true,
  biweekly: true,
  monthly: true,
};

export default defineComponent({
  name: "StepSchedulePage",

  components: { WizardStepShell },

  data: () => ({
    frequency: "weekly" as string,
    cronExpression: "",
    targetArticle: false,
    targetSocial: true,
    localeDe: true,
    localeEn: false,
    autoApproveChoice: "inherit" as AutoApproveChoice,
    presetOverrideValue: "" as PresetOverrideValue,
  }),

  computed: {
    slug(): string {
      const v = this.$route.params.slug;
      return Array.isArray(v) ? (v[0] ?? "") : v ?? "";
    },
    store() {
      return useRecurringWizardDraftStore();
    },
  },

  mounted() {
    const d = this.store.draft;
    if (!d.formatType) {
      void this.$router.replace({ name: "wizard-step-format-type", params: { slug: this.slug } });
      return;
    }
    this.store.markStepReached(2);
    // Initialize from draft. If frequency looks like a cron expression, fall
    // through to the custom branch.
    if (d.frequency && KNOWN_PRESETS[d.frequency]) {
      this.frequency = d.frequency;
    } else if (d.frequency) {
      this.frequency = "custom";
      this.cronExpression = d.frequency;
    }
    this.targetArticle = !!d.outputTargets.article;
    this.targetSocial = !!d.outputTargets.social;
    this.localeDe = d.targetLocales.includes("de");
    this.localeEn = d.targetLocales.includes("en");
    this.autoApproveChoice =
      d.autoApproveOverride === null
        ? "inherit"
        : d.autoApproveOverride
          ? "on"
          : "off";
    this.presetOverrideValue = d.socialImageStylePresetOverride ?? "";
  },

  methods: {
    persist(): void {
      const targetLocales: string[] = [];
      if (this.localeDe) targetLocales.push("de");
      if (this.localeEn) targetLocales.push("en");
      const autoApproveOverride: boolean | null =
        this.autoApproveChoice === "inherit"
          ? null
          : this.autoApproveChoice === "on";
      const persistedFrequency =
        this.frequency === "custom" ? this.cronExpression.trim() : this.frequency;
      const socialImageStylePresetOverride =
        this.presetOverrideValue === "" ? null : this.presetOverrideValue;
      this.store.patchDraft({
        frequency: persistedFrequency,
        outputTargets: { article: this.targetArticle, social: this.targetSocial },
        targetLocales: targetLocales.length > 0 ? targetLocales : ["de"],
        autoApproveOverride,
        socialImageStylePresetOverride,
      });
    },

    onBack(): void {
      this.persist();
      void this.$router.push({ name: "wizard-step-config", params: { slug: this.slug } });
    },

    onAdvance(): void {
      this.persist();
      if (this.frequency === "custom" && !this.cronExpression.trim()) return;
      if (!this.targetArticle && !this.targetSocial) return;
      if (!this.localeDe && !this.localeEn) return;
      this.store.markStepReached(3);
      void this.$router.push({ name: "wizard-step-review", params: { slug: this.slug } });
    },
  },
});
</script>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
.select-input,
.text-input {
  background: var(--surface-strong);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--text-primary);
  font: inherit;
}
.check-row {
  display: flex;
  gap: 18px;
  flex-wrap: wrap;
}
.check-item,
.radio-item {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.radio-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hint {
  font-size: 12px;
  color: var(--text-tertiary);
}
.hint-error {
  color: var(--text-error);
}
</style>
