/**
 * Spec 65.V1.5b — Recurring-content monthly-budget composable.
 *
 * Wraps GET /projects/:slug/recurring-budgets + PATCH …/:budgetType so the
 * Settings UI can render both budgets (dry_run + recurring_content_total)
 * with progress bars and let Marcel edit the monthly limit per budget.
 *
 * Values flow through cents in the API (avoid float drift) but the UI
 * exposes euros via helper formatters.
 */
import { ref, computed } from "vue";
import { apiGet, apiPatch } from "src/lib/api";

export type BudgetType = "dry_run" | "recurring_content_total";

export interface BudgetState {
  allowed: boolean;
  consumed: number;
  limit: number;
  currentMonth: number;
}

export interface BudgetsResponse {
  dry_run: BudgetState;
  recurring_content_total: BudgetState;
}

export function useRecurringBudgets(slug: string) {
  const budgets = ref<BudgetsResponse | null>(null);
  const loading = ref(false);
  const error = ref("");
  const saving = ref<BudgetType | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      budgets.value = await apiGet<BudgetsResponse>(
        `/projects/${slug}/recurring-budgets`,
      );
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to load budgets";
    } finally {
      loading.value = false;
    }
  }

  async function setMonthlyLimitEuro(
    budgetType: BudgetType,
    monthlyLimitEuro: number,
  ): Promise<void> {
    saving.value = budgetType;
    error.value = "";
    try {
      const cents = Math.round(monthlyLimitEuro * 100);
      const updated = await apiPatch<BudgetState>(
        `/projects/${slug}/recurring-budgets/${budgetType}`,
        { monthlyLimitCents: cents },
      );
      if (budgets.value) {
        budgets.value = { ...budgets.value, [budgetType]: updated };
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to save";
      throw err;
    } finally {
      saving.value = null;
    }
  }

  const dryRunPct = computed(() => {
    const b = budgets.value?.dry_run;
    if (!b || b.limit === 0) return 0;
    return Math.min(100, Math.round((b.consumed / b.limit) * 100));
  });
  const totalPct = computed(() => {
    const b = budgets.value?.recurring_content_total;
    if (!b || b.limit === 0) return 0;
    return Math.min(100, Math.round((b.consumed / b.limit) * 100));
  });

  return {
    budgets,
    loading,
    error,
    saving,
    load,
    setMonthlyLimitEuro,
    dryRunPct,
    totalPct,
  };
}

/** Render `cents` as `€X.XX`. */
export function formatCentsAsEuro(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}
