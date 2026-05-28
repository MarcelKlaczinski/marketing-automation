<template>
  <section class="recurring-defaults">
    <header class="section-header">
      <h2 class="section-title">{{ $t("settings.recurringDefaults.title") as string }}</h2>
      <p class="section-description">{{ $t("settings.recurringDefaults.description") as string }}</p>
    </header>

    <!-- Auto-approve toggle + image-style preset select share the same useSectionForm
         sub-form (so Marcel saves both with one click). -->
    <div class="field">
      <label class="checkbox-row">
        <input
          v-model="autoApproveModel"
          type="checkbox"
          class="checkbox-input"
        />
        <span>{{ $t("settings.recurringDefaults.autoApproveLabel") as string }}</span>
      </label>
      <small class="hint">{{ $t("settings.recurringDefaults.autoApproveHelper") as string }}</small>
    </div>

    <!-- Spec 65.16 — Image-Style preset selector (project default). -->
    <div class="field">
      <label class="select-label">
        {{ $t("settings.recurringDefaults.imageStylePreset.label") as string }}
      </label>
      <select v-model="imageStylePresetModel" class="select-input">
        <option
          v-for="preset in PRESET_OPTIONS"
          :key="preset"
          :value="preset"
        >
          {{ presetLabels[preset] }}
        </option>
      </select>
      <small class="hint">{{ presetDescriptions[imageStylePresetModel] }}</small>
    </div>

    <div v-if="autoApproveForm.dirty.value" class="actions">
      <q-btn flat dense :label="$t('common.cancel') as string" @click="autoApproveForm.cancel()" />
      <q-btn
        color="primary"
        dense
        :label="$t('common.save') as string"
        :loading="autoApproveForm.saving.value"
        @click="autoApproveForm.save()"
      />
    </div>

    <!-- Budgets -->
    <div v-if="bLoading" class="state-banner">{{ $t("common.loading") as string }}</div>
    <div v-else-if="bError" class="state-banner error">{{ bError }}</div>
    <div v-else-if="budgetsRef" class="budgets-grid">
      <BudgetCard
        :title="$t('settings.recurringDefaults.dryRun.title') as string"
        :hint="$t('settings.recurringDefaults.dryRun.hint') as string"
        :state="budgetsRef.dry_run"
        :saving="bSaving === 'dry_run'"
        @save="onSaveBudget('dry_run', $event)"
      />
      <BudgetCard
        :title="$t('settings.recurringDefaults.total.title') as string"
        :hint="$t('settings.recurringDefaults.total.hint') as string"
        :state="budgetsRef.recurring_content_total"
        :saving="bSaving === 'recurring_content_total'"
        @save="onSaveBudget('recurring_content_total', $event)"
      />
    </div>
  </section>
</template>

<script lang="ts">
import { defineComponent, type PropType, type Ref } from "vue";
import { useRecurringBudgets, type BudgetType } from "src/composables/useRecurringBudgets";
import BudgetCard from "./BudgetCard.vue";

type ImageStylePreset = "dark-neon-grid" | "light-editorial" | "blue-tech-gradient";

const PRESET_OPTIONS: readonly ImageStylePreset[] = [
  "dark-neon-grid",
  "light-editorial",
  "blue-tech-gradient",
] as const;

/**
 * Shape returned by `useSectionForm<{recurringAutoApproveDefault, socialImageStylePreset}>`.
 * `formData` / `dirty` / `saving` are Refs (NOT auto-unwrapped because they
 * are nested object fields, not top-level setup() returns — see Vue Options
 * API auto-unwrap rules). `.value` is required in both template and script.
 * `save()` is typed `Promise<unknown>` upstream — we never read the result.
 */
interface RecurringDefaultsForm {
  formData: Ref<{
    recurringAutoApproveDefault: boolean;
    socialImageStylePreset: ImageStylePreset;
  }>;
  dirty: Ref<boolean>;
  saving: Ref<boolean>;
  save: () => Promise<unknown>;
  cancel: () => void;
}

export default defineComponent({
  name: "RecurringDefaultsSection",

  components: { BudgetCard },

  props: {
    slug: { type: String, required: true },
    autoApproveForm: { type: Object as PropType<RecurringDefaultsForm>, required: true },
  },

  setup(props) {
    const {
      budgets,
      loading,
      error,
      saving,
      load,
      setMonthlyLimitEuro,
    } = useRecurringBudgets(props.slug);
    void load();
    return {
      budgetsRef: budgets,
      bLoading: loading,
      bError: error,
      bSaving: saving,
      setMonthlyLimitEuro,
      // Exposed so the template can iterate the preset list — module-level
      // const, not reactive, so no Ref unwrap concerns.
      PRESET_OPTIONS,
    };
  },

  computed: {
    autoApproveModel: {
      // useSectionForm's `formData` is a Ref<{recurringAutoApproveDefault, socialImageStylePreset}>.
      // Vue Options API only auto-unwraps top-level setup() returns, not
      // nested refs inside an object — so `.value` is required to access
      // the underlying reactive payload (matches translationForm pattern in
      // SettingsProjectPage.vue).
      get(): boolean {
        return this.autoApproveForm.formData.value.recurringAutoApproveDefault;
      },
      set(v: boolean) {
        this.autoApproveForm.formData.value.recurringAutoApproveDefault = v;
      },
    },
    imageStylePresetModel: {
      get(): ImageStylePreset {
        return this.autoApproveForm.formData.value.socialImageStylePreset;
      },
      set(v: ImageStylePreset) {
        this.autoApproveForm.formData.value.socialImageStylePreset = v;
      },
    },
    presetLabels(): Record<ImageStylePreset, string> {
      const base = "settings.recurringDefaults.imageStylePreset.options";
      return {
        "dark-neon-grid": this.$t(`${base}.dark-neon-grid.label`) as string,
        "light-editorial": this.$t(`${base}.light-editorial.label`) as string,
        "blue-tech-gradient": this.$t(`${base}.blue-tech-gradient.label`) as string,
      };
    },
    presetDescriptions(): Record<ImageStylePreset, string> {
      const base = "settings.recurringDefaults.imageStylePreset.options";
      return {
        "dark-neon-grid": this.$t(`${base}.dark-neon-grid.description`) as string,
        "light-editorial": this.$t(`${base}.light-editorial.description`) as string,
        "blue-tech-gradient": this.$t(`${base}.blue-tech-gradient.description`) as string,
      };
    },
  },

  methods: {
    async onSaveBudget(budgetType: BudgetType, monthlyEuro: number): Promise<void> {
      try {
        await this.setMonthlyLimitEuro(budgetType, monthlyEuro);
        this.$q.notify({
          type: "positive",
          message: this.$t("settings.recurringDefaults.saveSuccess") as string,
        });
      } catch (err) {
        this.$q.notify({
          type: "negative",
          message: err instanceof Error ? err.message : (this.$t("settings.recurringDefaults.saveError") as string),
        });
      }
    },
  },
});
</script>

<style scoped>
.recurring-defaults {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 24px;
  background: var(--surface-subtle);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
}

.section-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.section-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.section-description {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.checkbox-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
}
.checkbox-input {
  width: 16px;
  height: 16px;
  cursor: pointer;
}
.select-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, rgba(255, 255, 255, 0.75));
}
.select-input {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.12));
  background: var(--bg-glass-strong, rgba(255, 255, 255, 0.04));
  color: var(--text-primary, rgba(255, 255, 255, 0.92));
  font-size: 13px;
  cursor: pointer;
}
.select-input:focus {
  outline: 2px solid var(--accent-primary, oklch(64% 0.16 248));
  outline-offset: 2px;
}
.hint {
  font-size: 12px;
  color: var(--text-tertiary);
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.budgets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
}

.state-banner {
  padding: 12px;
  border-radius: 8px;
  background: var(--surface-strong);
  color: var(--text-secondary);
  font-size: 13px;
  text-align: center;
}
.state-banner.error {
  color: var(--text-error);
  background: color-mix(in oklch, var(--text-error) 12%, transparent);
}
</style>
