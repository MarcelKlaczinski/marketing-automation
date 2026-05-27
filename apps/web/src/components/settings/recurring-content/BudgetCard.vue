<template>
  <article class="budget-card">
    <header class="budget-header">
      <h3 class="budget-title">{{ title }}</h3>
      <span v-if="!state.allowed" class="chip-warn">
        {{ $t("settings.recurringDefaults.exhausted") as string }}
      </span>
    </header>
    <p class="budget-hint">{{ hint }}</p>

    <div class="progress-row">
      <q-linear-progress
        :value="pct / 100"
        :color="state.allowed ? 'primary' : 'warning'"
        size="6px"
      />
      <small class="progress-label mono">
        {{ formatCentsAsEuro(state.consumed) }} / {{ formatCentsAsEuro(state.limit) }}
      </small>
    </div>

    <div class="edit-row">
      <label class="edit-field">
        <span class="edit-label">{{ $t("settings.recurringDefaults.monthlyLimitLabel") as string }}</span>
        <input
          v-model.number="draftEuro"
          type="number"
          inputmode="decimal"
          min="0"
          step="1"
          class="text-input"
          :disabled="saving"
        />
      </label>
      <q-btn
        flat
        dense
        :disable="!isDirty || saving"
        :label="$t('common.save') as string"
        :loading="saving"
        @click="onSave"
      />
    </div>
  </article>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import type { BudgetState } from "src/composables/useRecurringBudgets";
import { formatCentsAsEuro } from "src/composables/useRecurringBudgets";

export default defineComponent({
  name: "BudgetCard",

  props: {
    title: { type: String, required: true },
    hint: { type: String, default: "" },
    state: { type: Object as PropType<BudgetState>, required: true },
    saving: { type: Boolean, default: false },
  },

  emits: ["save"],

  data() {
    return {
      // Initialise from prop; refresh whenever the upstream state changes.
      draftEuro: this.state.limit / 100,
    };
  },

  computed: {
    pct(): number {
      if (this.state.limit === 0) return 0;
      return Math.min(100, Math.round((this.state.consumed / this.state.limit) * 100));
    },
    isDirty(): boolean {
      return Math.round(this.draftEuro * 100) !== this.state.limit;
    },
  },

  watch: {
    "state.limit"(newLimit: number) {
      this.draftEuro = newLimit / 100;
    },
  },

  methods: {
    formatCentsAsEuro,
    onSave(): void {
      if (this.draftEuro < 0) return;
      this.$emit("save", this.draftEuro);
    },
  },
});
</script>

<style scoped>
.budget-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--surface-strong);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 14px 16px;
}

.budget-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.budget-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.chip-warn {
  background: color-mix(in oklch, var(--text-warning, #d97757) 18%, transparent);
  color: var(--text-warning, #d97757);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
}

.budget-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

.progress-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.progress-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: ui-monospace, "JetBrains Mono", "Menlo", monospace;
}

.edit-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.edit-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.edit-label {
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.text-input {
  background: var(--surface-subtle);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  padding: 6px 8px;
  color: var(--text-primary);
  font: inherit;
}
.text-input:focus {
  outline: none;
  border-color: var(--brand-primary);
}
</style>
