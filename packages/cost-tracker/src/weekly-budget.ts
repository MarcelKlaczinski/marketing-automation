// Spec 62.0a Section 5: weekly cost estimator for the Content Planner.
//
// Aggregates per-item cost estimates with a 3-tier fallback:
//   1. Sum `step.estimatedCostEur(predictedInput)` across the pipeline's steps.
//   2. If that returns 0 (no step overrides) or the pipeline is unknown, fall back to
//      a 30-day historical average from `cost_logs` grouped by `pipeline_run_id` joined
//      with `pipeline_runs.pipeline_name`.
//   3. If no historical data exists either, use a conservative hard-coded default
//      keyed by `itemType` (or `pipelineName` if itemType is unmapped).
//
// The total is multiplied by a 15% buffer (`BUFFER_FACTOR`) and compared against
// `weeklyBudgetEur`. Hard-stop logic lives in the planner-engine (Spec 62.4); this
// module only computes and reports.

import { and, costLogs, db, eq, gte, pipelineRuns, sql } from "@marketing-auto/db";
import { effectiveFreshness } from "./article-freshness.ts";

/** Default safety buffer applied to the aggregated estimate. */
export const BUFFER_FACTOR = 1.15;

/**
 * Spec 62.5.1: Anthropic Batch API discount factor.
 *
 * Anthropic charges roughly 50 % of sync rates for Batch API requests. When the
 * project's `llmMode === 'batch'`, every step flagged `llmBound = true` has its
 * tier-1 step-sum estimate multiplied by this factor. Historical (tier 2) and
 * default (tier 3) estimates are NOT discounted — they're already aggregated
 * across past runs and may include a mix of sync/batch, so the historical
 * average is already empirically batch-aware (or not, depending on the run mix).
 */
export const BATCH_DISCOUNT_FACTOR = 0.5;

/** Look-back window for the tier-2 historical-average query (`cost_logs` join). */
export const HISTORICAL_LOOKBACK_DAYS = 30;

/** Default cost in EUR per item type when both pipeline-step and historical data are unavailable. */
export const DEFAULT_COST_BY_ITEM_TYPE: Record<string, number> = {
  article: 0.3,
  blog_article: 0.3,
  translation: 0.1,
  social_image: 0.02,
  social_post: 0.02,
  cluster: 4.2,
  refresh: 0.4,
};

/** Default cost in EUR per pipeline name when itemType is unknown. */
export const DEFAULT_COST_BY_PIPELINE: Record<string, number> = {
  "article:blog": 0.3,
  "article:outline": 0.05,
  "article:draft": 0.18,
  "article:translation": 0.1,
  "article:refresh": 0.4,
  "article:social-image": 0.02,
  "article:schema-extension": 0.01,
  "cluster:full-plan": 0.4,
  "cluster:link-rebuild": 0.05,
};

/** Look up a default cost given itemType + pipelineName. itemType wins; falls back to pipelineName; then 0. */
export function defaultCostFor(itemType: string, pipelineName: string): number {
  const byType = DEFAULT_COST_BY_ITEM_TYPE[itemType];
  if (typeof byType === "number") return byType;
  const byPipeline = DEFAULT_COST_BY_PIPELINE[pipelineName];
  return typeof byPipeline === "number" ? byPipeline : 0;
}

export interface PlannedItem {
  id: string;
  itemType: string;
  pipelineName: string;
  predictedInput: unknown;
  /**
   * For refresh items, the underlying article. When provided AND its
   * effectiveFreshness is younger than `freshSkipThresholdDays`, the item is marked
   * "skipped, recent" and contributes €0 to the total.
   */
  refreshArticle?: {
    frontmatterUpdatedAt: Date | null;
    lastRefreshedAt: Date | null;
    publishedAt: Date | null;
    updatedAt: Date;
  };
}

export interface PerItemEstimate {
  itemId: string;
  itemType: string;
  pipelineName: string;
  /** Cost in EUR for this single item BEFORE the buffer. 0 = skipped (e.g. fresh refresh). */
  estimateEur: number;
  /** Which tier produced this estimate. Useful for the Planner UI to surface confidence. */
  source: "pipeline_steps" | "historical_avg" | "default" | "skipped_recent" | "zero";
}

export interface WeeklyBudgetEstimate {
  /** Raw aggregated cost across all items, before the buffer. */
  totalEstimateEur: number;
  /** Total × BUFFER_FACTOR. Compare against the budget. */
  bufferedEstimateEur: number;
  perItemBreakdown: PerItemEstimate[];
  budgetEur: number;
  withinBudget: boolean;
  /** Positive when bufferedEstimateEur exceeds budgetEur; null otherwise. */
  overrunEur: number | null;
}

/**
 * Spec 64.6b: optional project-level context passed to every step's
 * `estimatedCostEur` invocation. Used by `HeroImageStep` to swap the per-image
 * rate based on the project's image-generation provider + resolution toggle.
 * Steps that don't read the context (the default) safely ignore it — interfaces
 * accept extra arg via TypeScript's standard fn-arg variance.
 */
export interface EstimatorContext {
  imageProvider?: "nano-banana-2" | "nano-banana-pro" | "flux-1.1-pro";
  imageResolution?: "0.5k" | "1k" | "2k" | "4k";
}

/** Minimal step shape used to invoke `estimatedCostEur`. Avoids depending on the pipelines package. */
export interface EstimatorStep {
  estimatedCostEur: (input: unknown, context?: EstimatorContext) => number;
  /**
   * Spec 62.5.1: marks steps whose cost is dominated by an Anthropic LLM call.
   * When the project's `llmMode === 'batch'`, the estimator multiplies this
   * step's contribution by `BATCH_DISCOUNT_FACTOR`. Mixed-cost steps
   * (e.g. ResearchStep with DataForSEO + LLM) keep this false because only
   * part of their cost benefits from the batch discount.
   */
  llmBound?: boolean;
}

/** Callback to look up a pipeline's step list. Caller wires this to `pipelineRegistry.get(name)?.steps`. */
export type PipelineStepResolver = (pipelineName: string) => ReadonlyArray<EstimatorStep> | undefined;

export interface EstimateWeeklyPlanCostInput {
  plannedItems: PlannedItem[];
  weeklyBudgetEur: number;
  projectId: string;
  /**
   * Resolves pipelines by name for tier-1 step-sum estimates. When omitted, tier 1
   * is skipped and the estimator falls straight to historical → defaults.
   * The caller (apps/api / Planner-Engine) typically wires this to:
   *   `(name) => pipelineRegistry.get(name)?.steps as ReadonlyArray<EstimatorStep>`
   */
  resolvePipelineSteps?: PipelineStepResolver;
  /** Refresh items younger than this are skipped (€0). Default: 30 days. */
  freshSkipThresholdDays?: number;
  /**
   * Spec 62.5.1: LLM execution mode for this project. When `"batch"`, tier-1
   * step-sum estimates are multiplied by `BATCH_DISCOUNT_FACTOR` for every step
   * flagged `llmBound = true`. Defaults to `"sync"` (no discount applied).
   */
  llmMode?: "sync" | "batch";
  /**
   * Spec 64.6b: image-generation provider + resolution at plan-generation time.
   * Threaded into each step's `estimatedCostEur(input, ctx)` call so the
   * `HeroImageStep` can pick the resolution-aware per-image rate. Defaults are
   * a no-op for callers that don't set them.
   */
  imageProvider?: EstimatorContext["imageProvider"];
  imageResolution?: EstimatorContext["imageResolution"];
}

/**
 * Estimate the weekly cost of a planned set of items + compare against budget.
 *
 * Tier-1 returns 0 for any pipeline whose steps all use the default `estimatedCostEur()`
 * (= 0). The aggregator treats `sum === 0` as "tier-1 unavailable" and falls through.
 * This is deliberate — a pipeline that genuinely costs €0 (no paid steps) should fall
 * through too, and the historical/default tiers will both report 0 for it.
 */
export async function estimateWeeklyPlanCost(
  input: EstimateWeeklyPlanCostInput
): Promise<WeeklyBudgetEstimate> {
  const skipThreshold = input.freshSkipThresholdDays ?? 30;
  const now = Date.now();
  const breakdown: PerItemEstimate[] = [];

  // Tier 2 setup: load historical averages once per pipeline name in the plan.
  // 30-day window, scoped to this project. Group by pipeline_name; aggregate cost_logs.cost_eur.
  const pipelineNames = Array.from(new Set(input.plannedItems.map((i) => i.pipelineName)));
  const historical = await loadHistoricalAverages(input.projectId, pipelineNames);

  for (const item of input.plannedItems) {
    // Short-circuit: refresh items younger than the skip threshold cost €0.
    if (item.refreshArticle) {
      const ageDays = (now - effectiveFreshness(item.refreshArticle).getTime()) / 86_400_000;
      if (ageDays < skipThreshold) {
        breakdown.push({
          itemId: item.id,
          itemType: item.itemType,
          pipelineName: item.pipelineName,
          estimateEur: 0,
          source: "skipped_recent",
        });
        continue;
      }
    }

    // Tier 1: sum step estimates.
    if (input.resolvePipelineSteps) {
      const steps = input.resolvePipelineSteps(item.pipelineName);
      if (steps && steps.length > 0) {
        const isBatch = input.llmMode === "batch";
        // Spec 64.6b: thread image-generation context into every step's
        // estimator. HeroImageStep reads it to pick the resolution-aware rate;
        // every other step ignores the extra arg.
        const estimatorCtx: EstimatorContext = {};
        if (input.imageProvider !== undefined) estimatorCtx.imageProvider = input.imageProvider;
        if (input.imageResolution !== undefined) estimatorCtx.imageResolution = input.imageResolution;
        const sum = steps.reduce((acc, s) => {
          const raw = s.estimatedCostEur(item.predictedInput, estimatorCtx) || 0;
          // Spec 62.5.1: apply batch discount per-step so mixed pipelines
          // (some llmBound steps, some not) get a partial discount.
          const factor = isBatch && s.llmBound === true ? BATCH_DISCOUNT_FACTOR : 1;
          return acc + raw * factor;
        }, 0);
        if (sum > 0) {
          breakdown.push({
            itemId: item.id,
            itemType: item.itemType,
            pipelineName: item.pipelineName,
            estimateEur: sum,
            source: "pipeline_steps",
          });
          continue;
        }
      }
    }

    // Tier 2: historical avg.
    const histAvg = historical.get(item.pipelineName);
    if (typeof histAvg === "number" && histAvg > 0) {
      breakdown.push({
        itemId: item.id,
        itemType: item.itemType,
        pipelineName: item.pipelineName,
        estimateEur: histAvg,
        source: "historical_avg",
      });
      continue;
    }

    // Tier 3: conservative default.
    const fallback = defaultCostFor(item.itemType, item.pipelineName);
    breakdown.push({
      itemId: item.id,
      itemType: item.itemType,
      pipelineName: item.pipelineName,
      estimateEur: fallback,
      source: fallback === 0 ? "zero" : "default",
    });
  }

  const totalEstimateEur = breakdown.reduce((acc, r) => acc + r.estimateEur, 0);
  const bufferedEstimateEur = totalEstimateEur * BUFFER_FACTOR;
  const withinBudget = bufferedEstimateEur <= input.weeklyBudgetEur;
  const overrunEur = withinBudget ? null : bufferedEstimateEur - input.weeklyBudgetEur;

  return {
    totalEstimateEur,
    bufferedEstimateEur,
    perItemBreakdown: breakdown,
    budgetEur: input.weeklyBudgetEur,
    withinBudget,
    overrunEur,
  };
}

/**
 * Loads the 30-day average cost per pipeline_name for a project. Returns a Map keyed by
 * pipeline_name. Names absent from the map have no historical data.
 *
 * The query joins cost_logs.pipeline_run_id → pipeline_runs.id to recover pipeline_name,
 * sums cost_logs.cost_eur per parent run, then averages across runs of the same name.
 */
async function loadHistoricalAverages(
  projectId: string,
  pipelineNames: string[]
): Promise<Map<string, number>> {
  if (pipelineNames.length === 0) return new Map();
  const cutoff = new Date(
    Date.now() - HISTORICAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // Per-run cost = sum of all cost_logs.cost_eur whose pipeline_run_id chains back
  // (transitively, via parent_run_id) to the parent pipeline run. Simplification for
  // 62.0a: aggregate via the parent run ID directly (cost_logs.pipeline_run_id is set
  // by the cost-tracker to the substep run ID, then traced to parent via pipeline_runs.parent_run_id).
  // We approximate by joining cost_logs.pipeline_run_id → pipeline_runs.id, then
  // averaging cost over rows where pipeline_runs.parent_run_id is the parent run.
  // For correctness, we group by the parent pipeline_runs.id and sum costs across its substeps.
  const rows = await db
    .select({
      pipelineName: pipelineRuns.pipelineName,
      parentRunId: sql<string>`coalesce(${pipelineRuns.parentRunId}, ${pipelineRuns.id})`.as(
        "parent_run_id"
      ),
      cost: sql<string>`coalesce(sum(${costLogs.costEur}), 0)`.as("cost"),
    })
    .from(pipelineRuns)
    .leftJoin(costLogs, eq(costLogs.pipelineRunId, pipelineRuns.id))
    .where(
      and(
        eq(pipelineRuns.projectId, projectId),
        eq(pipelineRuns.status, "completed"),
        gte(pipelineRuns.createdAt, sql`${cutoff}::timestamptz`)
      )
    )
    .groupBy(pipelineRuns.pipelineName, sql`coalesce(${pipelineRuns.parentRunId}, ${pipelineRuns.id})`);

  // Aggregate per-run costs → per-pipeline-name averages, restricted to the names in the plan.
  const sums = new Map<string, { total: number; count: number }>();
  const wanted = new Set(pipelineNames);
  for (const r of rows) {
    if (!wanted.has(r.pipelineName)) continue;
    const cost = Number(r.cost);
    if (!Number.isFinite(cost) || cost <= 0) continue;
    const acc = sums.get(r.pipelineName) ?? { total: 0, count: 0 };
    acc.total += cost;
    acc.count += 1;
    sums.set(r.pipelineName, acc);
  }
  const averages = new Map<string, number>();
  for (const [name, { total, count }] of sums) {
    averages.set(name, total / count);
  }
  return averages;
}
