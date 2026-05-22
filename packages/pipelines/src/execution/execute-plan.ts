// Spec 62.8: production-run execution orchestrator.
//
// `executePlan(planId)` iterates a plan's pending `planned_items` and either
// (a) enqueues each item into the matching content-pipeline queue (article:blog
// for comparison + ki_wissen; article:social-image for social_post), or
// (b) runs the cluster-creation logic inline (cluster:full-plan is a free
// function — Memory D127, called out in Spec 62.8 §9 risks).
//
// Per-item flow:
//   1. Re-check budget gate (90% of weekly budget — Spec 62.5.1 buffer)
//      → if blocked: markPlannedItemBlocked + break the loop (no more items)
//   2. Route via `getPipelineForItem(item, llmMode)` (pure)
//   3. Pre-INSERT a `pipeline_runs` row in status='queued' so we have a
//      pipelineRunId to stamp on the planned_item before any BullMQ enqueue
//      (preRunId pattern from Spec 35+)
//   4. enqueue → BullMQ + markPlannedItemEnqueued
//      inline → markPlannedItemEnqueued + markPlannedItemInProgress + run + finalize
//   5. After every dispatch attempt, call maybeFinalizePlanStatus (idempotent)

import {
  db,
  eq,
  loadPendingItemsForPlan,
  markPlannedItemEnqueued,
  pipelineRuns,
  projects,
  weeklyPlans,
} from "@marketing-auto/db";
import { getPipelineForItem, isoWeekStartDate, type LlmMode } from "@marketing-auto/planner";
import { type ArticleCollectionType, createLogger } from "@marketing-auto/shared";
import { enqueueSocialImagePipeline } from "../article/social-image/trigger.ts";
import { runClusterFullPlanFromBrief } from "../cluster/full-plan/run-from-brief.ts";
import type { PlanExecutionJobResult } from "./plan-execution-queue.ts";
import {
  emitPlanStatusIfFinalized,
  transitionItemBlocked,
  transitionItemCompleted,
  transitionItemFailed,
  transitionItemInProgress,
} from "./status-publisher.ts";
import { checkWeeklyBudgetGate } from "./weekly-spend.ts";

const log = createLogger("pipelines:execute-plan");

/**
 * Run one plan-execution pass. Called by the BullMQ worker; idempotent —
 * items already past 'pending' are skipped by the underlying CAS helpers, so
 * re-entrancy (BullMQ stall, worker restart) is safe.
 */
export async function executePlan(planId: string): Promise<PlanExecutionJobResult> {
  // 1) Load plan + project context
  const [plan] = await db
    .select()
    .from(weeklyPlans)
    .where(eq(weeklyPlans.id, planId))
    .limit(1);
  if (!plan) {
    throw new Error(`executePlan: plan ${planId} not found`);
  }
  if (plan.status !== "approved" && plan.status !== "running") {
    log.warn(
      { planId, status: plan.status },
      "executePlan: plan not approved/running — skipping",
    );
    return {
      planId,
      enqueued: 0,
      inlineCompleted: 0,
      inlineFailed: 0,
      blocked: 0,
      blockReason: null,
    };
  }

  // Flip 'approved' → 'running' so the UI distinguishes "items dispatching" from
  // "items still queued in the planner". Idempotent — the WHERE filter only
  // fires the UPDATE when status is still 'approved'.
  if (plan.status === "approved") {
    await db
      .update(weeklyPlans)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(weeklyPlans.id, planId));
  }

  // 2) Resolve llmMode — Spec 62.5.1 ssoT: the frozen snapshot, not the live
  // projects.llm_mode column. The snapshot is set at plan-generation time and
  // never changes; reading from projects.llm_mode would produce different
  // cost-discount behaviour if Marcel toggled the project mode between
  // generation and execution.
  const snapshot = (plan.inputSnapshot as { config?: { llmMode?: LlmMode } } | null) ?? null;
  const llmMode: LlmMode = snapshot?.config?.llmMode ?? "sync";

  // 3) Compute the ISO-week start for the budget-gate sums.
  const weekStartUtc = isoWeekStartDate(plan.year, plan.isoWeek);

  // 4) Load pending items in execution order.
  const items = await loadPendingItemsForPlan(planId);
  const stats: PlanExecutionJobResult = {
    planId,
    enqueued: 0,
    inlineCompleted: 0,
    inlineFailed: 0,
    blocked: 0,
    blockReason: null,
  };

  // Cache project slug once — needed for the inline cluster path's logs +
  // future SSE event payloads.
  const [projRow] = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, plan.projectId))
    .limit(1);
  const projectSlug = projRow?.slug ?? "(unknown)";

  for (const item of items) {
    // Budget gate
    const itemCostEur = Number.parseFloat(item.estimatedCostEur ?? "0");
    const gate = await checkWeeklyBudgetGate({
      projectId: plan.projectId,
      weekStartUtc,
      extraCostEur: Number.isFinite(itemCostEur) ? itemCostEur : 0,
    });
    if (!gate.allowed) {
      log.warn(
        {
          planId,
          itemId: item.id,
          spend: gate.spend,
          budget: gate.budget,
          threshold: gate.threshold,
        },
        "executePlan: budget gate fired — stopping dispatch",
      );
      await transitionItemBlocked({
        projectId: plan.projectId,
        planId: plan.id,
        itemId: item.id,
        reason: gate.reason,
      });
      stats.blocked += 1;
      stats.blockReason = gate.reason;
      break;
    }

    // Route
    let routed: ReturnType<typeof getPipelineForItem>;
    try {
      routed = getPipelineForItem(item, llmMode);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "routing failure";
      log.error({ err, itemId: item.id }, "executePlan: router threw");
      // No pipeline_runs row created yet — flip the item straight from
      // pending → failed. `markPlannedItemFailed` accepts 'pending' as a
      // valid prior status specifically for this routing-error path.
      await transitionItemFailed({
        projectId: plan.projectId,
        planId,
        itemId: item.id,
        reason,
      });
      stats.inlineFailed += 1;
      continue;
    }

    // Pre-create the pipeline_runs row so the planned_item carries a stable
    // run id from the moment it leaves 'pending'. The shared queue worker
    // (queue.ts) updates this row from 'queued' → 'running' when picking up
    // the job; for inline cluster execution we flip status manually below.
    const [run] = await db
      .insert(pipelineRuns)
      .values({
        projectId: plan.projectId,
        pipelineName:
          routed.kind === "inline" ? "cluster:full-plan" : routed.pipelineName,
        status: "queued",
        input:
          routed.kind === "inline"
            ? ({ briefId: routed.briefId, plannedItemId: item.id } as Record<string, unknown>)
            : ({ ...routed.jobData } as Record<string, unknown>),
      })
      .returning({ id: pipelineRuns.id });
    const runId = run!.id;

    if (routed.kind === "enqueue") {
      // BullMQ dispatch. The shared pipeline worker (queue.ts) handles the
      // enqueued → in_progress flip when it picks up the job; afterComplete /
      // afterError finalize completed / failed (Phase 3 wires those hooks).
      try {
        if (routed.pipelineName === "article:blog") {
          const blogInput = routed.jobData as {
            briefId?: string;
            articleId?: string;
            projectId?: string;
            collectionType?: ArticleCollectionType;
          };
          // briefId is required by enqueueBlogGenerationPipeline. Planner
          // emits it via pipelineInputFromBrief — fail loud if missing.
          if (!blogInput.briefId) {
            throw new Error(
              `article:blog dispatch missing briefId in pipelineInput (item ${item.id})`,
            );
          }
          // The thin preRunId-aware wrapper needs an articleId before any DB
          // INSERT. The planner doesn't pre-create the article (only the brief);
          // we fall back to enqueueBlogGeneration which creates the article
          // from the brief. That trigger ALSO uses a stable jobId, so this is
          // dedup-safe.
          // — Two-step path: import enqueueBlogGeneration lazily to avoid
          // circular module-load with the trigger file.
          const { enqueueBlogGeneration } = await import("../article/blog/trigger.ts");
          // Spec 63.7b: thread collectionType from the router decision into
          // article creation + pipelineInput. Router emits enum values
          // ("blog" | "comparison" | "ki-wissen" | "usecases") matching
          // `ArticleCollectionType`; createBlogArticleFromBrief maps the enum
          // to the Astro folder name for articles.collection, and the bridge
          // → PersistArticleStep also writes the final collection. Omitted
          // when undefined (back-compat for unrouted callers).
          const enqueueBlogInput: Parameters<typeof enqueueBlogGeneration>[0] = {
            briefId: blogInput.briefId,
            projectId: plan.projectId,
            preRunId: runId,
            plannedItemId: item.id,
            // Spec 64.7: thread the frozen snapshot llmMode so plan-dispatched
            // runs match the cost the user approved. Without this the run
            // falls back to projects.llmMode (which could have flipped after
            // plan approval) and HeroImageStep would route wrong.
            overrideLlmMode: llmMode,
          };
          if (blogInput.collectionType !== undefined) {
            enqueueBlogInput.collectionType = blogInput.collectionType;
          }
          const result = await enqueueBlogGeneration(enqueueBlogInput);
          await markPlannedItemEnqueued({ itemId: item.id, pipelineRunId: runId });
          stats.enqueued += 1;
          log.info(
            {
              planId,
              itemId: item.id,
              runId,
              articleId: result.articleId,
              jobId: result.jobId,
              contentType: item.contentType,
            },
            "executePlan: blog item enqueued",
          );
        } else if (routed.pipelineName === "article:social-image") {
          const sj = routed.jobData as {
            articleId?: string;
            templateKey?: string | null;
            theme?: "dark" | "light";
            variant?: "stunning";
          };
          if (!sj.articleId) {
            throw new Error(
              `article:social-image dispatch missing articleId in pipelineInput (item ${item.id})`,
            );
          }
          const enqueueOpts: Parameters<typeof enqueueSocialImagePipeline>[0] = {
            articleId: sj.articleId,
            projectId: plan.projectId,
            preRunId: runId,
            plannedItemId: item.id,
          };
          if (sj.theme !== undefined) enqueueOpts.theme = sj.theme;
          if (sj.variant !== undefined) enqueueOpts.variant = sj.variant;
          if (sj.templateKey !== undefined) enqueueOpts.templateKey = sj.templateKey;
          const { jobId } = await enqueueSocialImagePipeline(enqueueOpts);
          await markPlannedItemEnqueued({ itemId: item.id, pipelineRunId: runId });
          stats.enqueued += 1;
          log.info(
            { planId, itemId: item.id, runId, jobId, articleId: sj.articleId },
            "executePlan: social-image item enqueued",
          );
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "dispatch failure";
        log.error({ err, itemId: item.id, planId }, "executePlan: enqueue failed");
        // Best-effort: settle the pipeline_runs row + mark item failed.
        // `markPlannedItemFailed` accepts 'pending' so we don't need a
        // synthetic enqueued flip when the BullMQ add() itself threw.
        await db
          .update(pipelineRuns)
          .set({ status: "failed", errorMessage: reason, completedAt: new Date() })
          .where(eq(pipelineRuns.id, runId));
        await transitionItemFailed({
          projectId: plan.projectId,
          planId,
          itemId: item.id,
          reason,
        });
        stats.inlineFailed += 1;
      }
    } else {
      // Inline cluster:full-plan execution. Spec 62.8 §9 risks: stays sync
      // even when llmMode === 'batch' because generateClusterPlan is a free
      // function (no BaseStep override surface).
      await markPlannedItemEnqueued({ itemId: item.id, pipelineRunId: runId });
      await transitionItemInProgress({
        projectId: plan.projectId,
        planId,
        itemId: item.id,
      });
      await db
        .update(pipelineRuns)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(pipelineRuns.id, runId));
      try {
        const result = await runClusterFullPlanFromBrief({
          briefId: routed.briefId,
          projectId: plan.projectId,
          pipelineRunId: runId,
        });
        await db
          .update(pipelineRuns)
          .set({
            status: "completed",
            output: {
              clusterId: result.clusterId,
              pillarId: result.pillarId,
              spokeCount: result.spokeCount,
            },
            completedAt: new Date(),
          })
          .where(eq(pipelineRuns.id, runId));
        await transitionItemCompleted({
          projectId: plan.projectId,
          planId,
          itemId: item.id,
        });
        stats.inlineCompleted += 1;
        log.info(
          {
            planId,
            itemId: item.id,
            runId,
            clusterId: result.clusterId,
            spokeCount: result.spokeCount,
            projectSlug,
          },
          "executePlan: cluster item completed inline",
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : "cluster execution failed";
        log.error({ err, itemId: item.id, runId, planId }, "executePlan: cluster failed");
        await db
          .update(pipelineRuns)
          .set({ status: "failed", errorMessage: reason, completedAt: new Date() })
          .where(eq(pipelineRuns.id, runId));
        await transitionItemFailed({
          projectId: plan.projectId,
          planId,
          itemId: item.id,
          reason,
        });
        stats.inlineFailed += 1;
        // Continue — a single cluster failure should not stop the rest of
        // the plan from being dispatched.
      }
    }
  }

  // Final aggregation pass in case the last items terminated quickly enough
  // that none of the per-item calls saw all rows finalized.
  await emitPlanStatusIfFinalized(plan.projectId, planId);

  log.info(
    {
      planId,
      enqueued: stats.enqueued,
      inlineCompleted: stats.inlineCompleted,
      inlineFailed: stats.inlineFailed,
      blocked: stats.blocked,
    },
    "executePlan: dispatch complete",
  );

  return stats;
}
