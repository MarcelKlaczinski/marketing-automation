// Spec 62.2: Library-export validator for project goals + planner config.
// Spec 62.3.5: migrated from packages/cost-tracker (boundary cleanup).
//
// Consumed by:
//   - GET /projects/:slug/goals/validate (HTTP)
//   - 62.4 Planner-Engine as its first pre-flight check before generating a plan
//
// Lives in `packages/planner`. May depend on `packages/cost-tracker`
// (`estimateWeeklyPlanCost`) — directed dep, no cycle. Must NOT depend on
// `packages/pipelines` (Lesson D15 from 62.0a). Pipeline-step lookup is injected
// via a `PipelineStepResolver` callback.
//
// Returns advisory warnings alongside hard errors. `valid` is true iff `errors.length === 0`.

import {
  getProjectPlannerConfig,
  listProjectGoals,
  type ProjectGoal,
  type ProjectPlannerConfig,
} from "@marketing-auto/db";
import {
  estimateWeeklyPlanCost,
  type PipelineStepResolver,
  type PlannedItem,
} from "@marketing-auto/cost-tracker";

export const GOAL_VALIDATION_ERROR_CODES = [
  "NO_GOALS_DEFINED",
  "NO_PLANNER_CONFIG",
  "FLOOR_EXCEEDS_BUDGET",
  "INVALID_CADENCE_UNIT",
  "INVALID_MIN_MAX",
] as const;
export type GoalValidationErrorCode = (typeof GOAL_VALIDATION_ERROR_CODES)[number];

export const GOAL_VALIDATION_WARNING_CODES = [
  "FLOOR_NEAR_BUDGET",
  "SUB_BUDGETS_OVER_GLOBAL",
  "ALL_GOALS_INACTIVE_OR_ZERO",
] as const;
export type GoalValidationWarningCode = (typeof GOAL_VALIDATION_WARNING_CODES)[number];

export interface GoalValidationIssue<TCode extends string> {
  code: TCode;
  message: string;
  /** Optional payload — varies by code; UI uses it to surface numbers in the banner. */
  details?: Record<string, unknown>;
}

export interface GoalValidationResult {
  valid: boolean;
  errors: Array<GoalValidationIssue<GoalValidationErrorCode>>;
  warnings: Array<GoalValidationIssue<GoalValidationWarningCode>>;
  resolvedGoals: ProjectGoal[];
  config: ProjectPlannerConfig | null;
  /** When config + goals exist, the weekly floor cost estimate (before buffer). null otherwise. */
  estimatedWeeklyFloorEur: number | null;
}

export interface ValidateProjectGoalsOptions {
  /**
   * Tier-1 lookup for cost estimation. When omitted, the validator falls straight to
   * historical / default tiers. Callers in apps/api wire this to
   * `(name) => pipelineRegistry.get(name)?.steps`.
   */
  resolvePipelineSteps?: PipelineStepResolver;
  /** Warning threshold: floor cost / budget ratio above which FLOOR_NEAR_BUDGET fires. */
  nearBudgetRatio?: number;
}

/**
 * Map a goal's content type onto the pipeline name that 62.4 will use to fulfil one unit
 * of cadence. Conservative defaults — extend this when the Planner adds new content types.
 *
 * Important: this is purely for cost-estimation purposes. The actual pipeline used at
 * plan-execution time will be decided by 62.4 based on signal data + cluster state.
 */
const CONTENT_TYPE_TO_PIPELINE: Record<string, { itemType: string; pipelineName: string }> = {
  cluster: { itemType: "cluster", pipelineName: "cluster:full-plan" },
  comparison: { itemType: "blog_article", pipelineName: "article:blog" },
  social_post: { itemType: "social_image", pipelineName: "article:social-image" },
  ki_wissen: { itemType: "blog_article", pipelineName: "article:blog" },
};

/** Convert a goal's (cadenceUnit, minCount) into the expected weekly item count. */
export function weeklyCountFromGoal(goal: ProjectGoal): number {
  return goal.cadenceUnit === "per_day" ? goal.minCount * 7 : goal.minCount;
}

/**
 * Translate goals into `PlannedItem[]` for `estimateWeeklyPlanCost`. Each goal expands
 * into `weeklyCount` synthetic items whose pipeline mapping is taken from
 * `CONTENT_TYPE_TO_PIPELINE`.
 */
function expandGoalsToPlannedItems(goals: ProjectGoal[]): PlannedItem[] {
  const items: PlannedItem[] = [];
  for (const goal of goals) {
    const mapping = CONTENT_TYPE_TO_PIPELINE[goal.contentType];
    if (!mapping) continue;
    const weeklyCount = weeklyCountFromGoal(goal);
    for (let i = 0; i < weeklyCount; i++) {
      items.push({
        id: `${goal.id}:${i}`,
        itemType: mapping.itemType,
        pipelineName: mapping.pipelineName,
        predictedInput: {},
      });
    }
  }
  return items;
}

export async function validateProjectGoals(
  projectId: string,
  options: ValidateProjectGoalsOptions = {}
): Promise<GoalValidationResult> {
  const nearBudgetRatio = options.nearBudgetRatio ?? 0.85;
  const errors: Array<GoalValidationIssue<GoalValidationErrorCode>> = [];
  const warnings: Array<GoalValidationIssue<GoalValidationWarningCode>> = [];

  const [goals, config] = await Promise.all([
    listProjectGoals({ projectId, activeOnly: true }),
    getProjectPlannerConfig(projectId),
  ]);

  if (goals.length === 0) {
    errors.push({
      code: "NO_GOALS_DEFINED",
      message: "Project has no active goals — the Planner has nothing to generate.",
    });
  }

  if (!config) {
    errors.push({
      code: "NO_PLANNER_CONFIG",
      message: "Project has no planner_config row — weekly budget is undefined.",
    });
  }

  // Defensive — Zod gates the API layer, but a hand-written DB row could slip through.
  for (const goal of goals) {
    if (goal.cadenceUnit !== "per_day" && goal.cadenceUnit !== "per_week") {
      errors.push({
        code: "INVALID_CADENCE_UNIT",
        message: `Goal ${goal.id} has invalid cadence_unit '${goal.cadenceUnit}'.`,
        details: { goalId: goal.id, cadenceUnit: goal.cadenceUnit },
      });
    }
    if (goal.maxCount !== null && goal.maxCount < goal.minCount) {
      errors.push({
        code: "INVALID_MIN_MAX",
        message: `Goal ${goal.id} has max_count (${goal.maxCount}) < min_count (${goal.minCount}).`,
        details: { goalId: goal.id, minCount: goal.minCount, maxCount: goal.maxCount },
      });
    }
  }

  if (goals.length > 0 && goals.every((g) => g.minCount === 0)) {
    warnings.push({
      code: "ALL_GOALS_INACTIVE_OR_ZERO",
      message: "All active goals have min_count = 0 — the Planner will not be obliged to generate anything.",
    });
  }

  let estimatedWeeklyFloorEur: number | null = null;

  if (config && goals.length > 0) {
    const plannedItems = expandGoalsToPlannedItems(goals);
    const weeklyBudgetNum = Number.parseFloat(config.weeklyBudgetEur);
    if (Number.isFinite(weeklyBudgetNum) && weeklyBudgetNum > 0) {
      const estimate = await estimateWeeklyPlanCost({
        plannedItems,
        weeklyBudgetEur: weeklyBudgetNum,
        projectId,
        ...(options.resolvePipelineSteps !== undefined
          ? { resolvePipelineSteps: options.resolvePipelineSteps }
          : {}),
      });
      estimatedWeeklyFloorEur = estimate.totalEstimateEur;

      if (estimate.totalEstimateEur > weeklyBudgetNum) {
        errors.push({
          code: "FLOOR_EXCEEDS_BUDGET",
          message: `Floor cost €${estimate.totalEstimateEur.toFixed(2)} exceeds weekly budget €${weeklyBudgetNum.toFixed(2)}.`,
          details: {
            floorEur: estimate.totalEstimateEur,
            budgetEur: weeklyBudgetNum,
          },
        });
      } else if (estimate.totalEstimateEur >= weeklyBudgetNum * nearBudgetRatio) {
        warnings.push({
          code: "FLOOR_NEAR_BUDGET",
          message: `Floor cost €${estimate.totalEstimateEur.toFixed(2)} consumes ≥${Math.round(nearBudgetRatio * 100)}% of the weekly budget €${weeklyBudgetNum.toFixed(2)} — little room for signal-driven overage.`,
          details: {
            floorEur: estimate.totalEstimateEur,
            budgetEur: weeklyBudgetNum,
            ratio: estimate.totalEstimateEur / weeklyBudgetNum,
          },
        });
      }
    }

    if (config.perTypeMaxEur) {
      const subBudgetTotal = Object.values(config.perTypeMaxEur).reduce(
        (acc, v) => acc + (Number.isFinite(v) ? v : 0),
        0
      );
      if (Number.isFinite(weeklyBudgetNum) && subBudgetTotal > weeklyBudgetNum) {
        warnings.push({
          code: "SUB_BUDGETS_OVER_GLOBAL",
          message: `Sub-budget caps sum to €${subBudgetTotal.toFixed(2)}, exceeding the global weekly budget €${weeklyBudgetNum.toFixed(2)}. The global cap still wins.`,
          details: { subBudgetTotalEur: subBudgetTotal, budgetEur: weeklyBudgetNum },
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    resolvedGoals: goals,
    config,
    estimatedWeeklyFloorEur,
  };
}
