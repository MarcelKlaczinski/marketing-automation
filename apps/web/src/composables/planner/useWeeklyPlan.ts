import { computed, type Ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { apiGet } from "src/lib/api";
import { useProjectStore } from "src/stores/project";
import type {
  PlannedItem,
  WeeklyPlan,
  WeeklyPlanDetail,
  WeeklyPlanStatus,
} from "src/types/ui";

/** GET /projects/:slug/plans?year=X&week=Y returns an array; we use the first. */
type PlansListResponse = WeeklyPlan[];

/**
 * GET /projects/:slug/planner-config → { weeklyBudgetEur, perTypeMaxEur, ... }
 * Numeric columns arrive as strings.
 */
export interface PlannerConfigResponse {
  projectId: string;
  weeklyBudgetEur: string;
  perTypeMaxEur: Record<string, number> | null;
  topNSignalsAllowedOverage: number;
  maxOveragePerSignal: number;
  signalMaxAgeHours: number;
  excludedPipelines: string[];
  // Spec 62.7: cron-trigger fields. Optional because rows created before
  // migration 0077 may still be hydrating in the wild.
  cronEnabled?: boolean;
  cronDayOfWeek?: number;
  cronHourUtc?: number;
}

export interface UseWeeklyPlanInput {
  year: Ref<number>;
  isoWeek: Ref<number>;
}

/**
 * Loads the active weekly plan for (project, year, isoWeek), its planned_items,
 * and the project planner-config (for the budget bar). The list endpoint filters
 * by year+week, so we read the first row — there can be at most one active per
 * (project, year, week) by partial unique index.
 */
export function useWeeklyPlan(input: UseWeeklyPlanInput): {
  plan: Ref<WeeklyPlan | null>;
  items: Ref<PlannedItem[]>;
  config: Ref<PlannerConfigResponse | null>;
  isPending: Ref<boolean>;
  refetch: () => Promise<void>;
} {
  const projectStore = useProjectStore();
  const queryClient = useQueryClient();

  const plansListQuery = useQuery({
    queryKey: computed(() => [
      "planner",
      "plans-list",
      projectStore.currentSlug,
      input.year.value,
      input.isoWeek.value,
    ]),
    queryFn: () =>
      apiGet<PlansListResponse>(
        `/projects/${projectStore.currentSlug}/plans?year=${input.year.value}&week=${input.isoWeek.value}&limit=10`,
      ),
  });

  // Pick the first active plan (status NOT IN superseded/cancelled).
  const activePlanFromList = computed<WeeklyPlan | null>(() => {
    const list = plansListQuery.data.value ?? [];
    const INACTIVE: WeeklyPlanStatus[] = ["superseded", "cancelled"];
    return list.find((p) => !INACTIVE.includes(p.status)) ?? list[0] ?? null;
  });

  // Fetch full detail (plan + items) when we have a plan id. `enabled` gates
  // the fetch — the queryFn only runs after activePlanFromList resolves to
  // a row, so `planId!` is safe at the call site.
  const planDetailQuery = useQuery({
    queryKey: computed(() => [
      "planner",
      "plan-detail",
      projectStore.currentSlug,
      activePlanFromList.value?.id ?? null,
    ]),
    queryFn: () => {
      const planId = activePlanFromList.value?.id;
      // Guarded by `enabled` above — this throw is unreachable but keeps the
      // return type honest (no never-matching union with a fake placeholder).
      if (!planId) throw new Error("planDetailQuery ran without an active plan id");
      return apiGet<WeeklyPlanDetail>(
        `/projects/${projectStore.currentSlug}/plans/${planId}`,
      );
    },
    enabled: computed(() => activePlanFromList.value?.id !== undefined),
  });

  const configQuery = useQuery({
    queryKey: computed(() => ["planner", "config", projectStore.currentSlug]),
    queryFn: () =>
      apiGet<PlannerConfigResponse | null>(
        `/projects/${projectStore.currentSlug}/planner-config`,
      ),
  });

  const plan = computed<WeeklyPlan | null>(
    () => planDetailQuery.data.value?.plan ?? activePlanFromList.value,
  );
  const items = computed<PlannedItem[]>(() => planDetailQuery.data.value?.items ?? []);
  const config = computed<PlannerConfigResponse | null>(() => configQuery.data.value ?? null);
  // Only consider planDetailQuery loading when it is actually enabled (i.e. an
  // active plan id exists). With TanStack Query v5, a disabled query keeps
  // `isPending === true` forever, which would otherwise pin the spinner on a
  // freshly-wiped DB (no plans → enabled=false → empty state never shows).
  const isPending = computed<boolean>(
    () =>
      plansListQuery.isPending.value ||
      (activePlanFromList.value?.id !== undefined && planDetailQuery.isPending.value),
  );

  async function refetch(): Promise<void> {
    await queryClient.invalidateQueries({
      queryKey: ["planner"],
    });
  }

  return { plan, items, config, isPending, refetch };
}
