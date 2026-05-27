<template>
  <section class="recurring-defaults">
    <header class="section-header">
      <h2 class="section-title">{{ $t("settings.recurringDefaults.title") as string }}</h2>
      <p class="section-description">{{ $t("settings.recurringDefaults.description") as string }}</p>
    </header>

    <!-- Auto-approve toggle (binds to useSectionForm sub-form) -->
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
      <!--
        useSectionForm returns refs as object FIELDS. Vue Options API only
        auto-unwraps top-level setup() returns, not nested refs — so `.value`
        is required in both template AND script (matches translationForm /
        socialForm pattern in SettingsProjectPage.vue).
      -->
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

/**
 * Shape returned by `useSectionForm<{recurringAutoApproveDefault: boolean}>`.
 * `formData` / `dirty` / `saving` are Refs (NOT auto-unwrapped because they
 * are nested object fields, not top-level setup() returns — see Vue Options
 * API auto-unwrap rules). `.value` is required in both template and script.
 * `save()` is typed `Promise<unknown>` upstream — we never read the result.
 */
interface RecurringDefaultsForm {
  formData: Ref<{ recurringAutoApproveDefault: boolean }>;
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
    };
  },

  computed: {
    autoApproveModel: {
      // useSectionForm's `formData` is a Ref<{recurringAutoApproveDefault}>.
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
