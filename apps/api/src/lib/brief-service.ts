import { COST_OPS } from "@marketing-auto/core";
import {
  and,
  db,
  eq,
  inArray,
  topicBriefs,
} from "@marketing-auto/db";
import {
  enqueueBlogGenerationPipeline,
  enqueueSocialImagePipeline,
  executeDecision,
  type GenerationMode,
  type RoutingDecision,
} from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { triggerWithPreRunId } from "../routes/_lib/trigger-helpers.ts";
import { createRecurringContentArticle } from "./recurring-content/create-article.ts";

const log = createLogger("brief-service");

type Project = { id: string };

export type Dispatch = "plan" | "immediate";

export type ApproveBriefResult =
  | { kind: "success"; runId: string; jobId: string }
  | { kind: "plan_queued" }
  | { kind: "cluster_assignment_required" }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; error: string };

/**
 * Spec 63.6: dispatch-aware brief approval. Default `'plan'` flips pending →
 * plan_pending and lets the Planner pick the brief up at the next cycle (90%
 * Budget-Gate active). `'immediate'` keeps the legacy direct-generate path:
 * create the article row + enqueue article:blog inline.
 *
 * Both branches are idempotent at the CAS level (WHERE approval_status='pending').
 * A second call on the same brief returns `kind: "skipped"`.
 */
export async function approveBrief(
  briefId: string,
  project: Project,
  dispatch: Dispatch = "plan",
): Promise<ApproveBriefResult> {
  // Spec 65.10: widen the SELECT to also accept `plan_pending` because
  // recurring-content briefs (Spec 65.5) land directly in that state, never
  // in `pending`. Non-recurring sources keep the legacy `pending` entrypoint.
  const [brief] = await db
    .select()
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.id, briefId),
        eq(topicBriefs.projectId, project.id),
        inArray(topicBriefs.approvalStatus, ["pending", "plan_pending"]),
      ),
    )
    .limit(1);

  if (!brief) {
    return { kind: "skipped", reason: "not_found_or_not_pending" };
  }

  // Spec 65.10: recurring briefs have their own gate predicate.
  // clusterAction='standalone' + clusterId=null are structural for recurring
  // content (Spec 65.5 §3.7) — inheriting the non-recurring gate would 409
  // every recurring approval. Route to the recurring-specific handler.
  if (brief.source === "recurring") {
    return await approveRecurringBrief(brief, project, dispatch);
  }

  // Reject a non-recurring brief that lands here as plan_pending — the
  // existing flow only transitions from pending. (Recurring is the only
  // source that ever pre-seeds plan_pending today.)
  if (brief.approvalStatus !== "pending") {
    return { kind: "skipped", reason: "not_found_or_not_pending" };
  }

  // Spec 64.9: path-aware cluster gate.
  //
  // Plan-dispatch lets the weekly Planner route the brief:
  //   - `create_new` → routed to `cluster:full-plan` (Planner generates cluster + spokes)
  //   - `comparison` → routed to `article:blog` collection=comparison (cluster-less by design)
  //   - `append_to_existing` WITH clusterId → spoke under that cluster
  //   - `append_to_existing` WITHOUT clusterId → editorial gap; Marcel must assign a cluster
  //
  // Immediate-dispatch still requires a concrete clusterId because executeDecision
  // INSERTs an article row that downstream pipelines join against; create_new and
  // null-cluster briefs can't go inline.
  if (dispatch === "plan") {
    if (brief.clusterAction === "append_to_existing" && !brief.clusterId) {
      return { kind: "cluster_assignment_required" };
    }
    return await markBriefPlanPending(briefId, project.id);
  }

  if (brief.clusterAction === "create_new" || !brief.clusterId) {
    return { kind: "cluster_assignment_required" };
  }
  return await approveBriefAndEnqueueImmediate(brief, project);
}

/**
 * Plan-dispatch branch: pending → plan_pending. No article row, no pipeline
 * enqueue. The Planner's `loadPendingTopicBriefs` widens to include plan_pending
 * (Spec 63.6) so the brief lands in the next weekly plan.
 *
 * CAS-guarded on `approval_status='pending'` — concurrent immediate-dispatch on
 * the same brief loses the race and we return `skipped`.
 */
async function markBriefPlanPending(
  briefId: string,
  projectId: string,
): Promise<ApproveBriefResult> {
  const updated = await db
    .update(topicBriefs)
    .set({
      approvalStatus: "plan_pending",
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(topicBriefs.id, briefId),
        eq(topicBriefs.projectId, projectId),
        eq(topicBriefs.approvalStatus, "pending"),
      ),
    )
    .returning({ id: topicBriefs.id });

  if (updated.length === 0) {
    return { kind: "skipped", reason: "not_found_or_not_pending" };
  }

  log.info({ briefId, projectId }, "brief flipped to plan_pending");
  return { kind: "plan_queued" };
}

/**
 * Immediate-dispatch branch: legacy approveBriefAndEnqueue behaviour — creates
 * the article row via executeDecision (pending → routed inside the transaction)
 * and enqueues article:blog. Bypasses the Planner / Budget-Gate; use sparingly.
 */
async function approveBriefAndEnqueueImmediate(
  brief: typeof topicBriefs.$inferSelect,
  project: Project,
): Promise<ApproveBriefResult> {
  if (!brief.clusterId) {
    // Defensive — approveBrief already gated, but keep the type narrow for executeDecision.
    return { kind: "cluster_assignment_required" };
  }

  const decision: RoutingDecision = {
    kind: "create_article",
    clusterId: brief.clusterId,
    intentType: brief.intentType ?? "general",
    mode: (brief.generationMode ?? "spoke") as GenerationMode,
  };

  const routeResult = await db.transaction(async (tx) => executeDecision(decision, brief, tx));

  if (routeResult.kind === "skipped") {
    return { kind: "skipped", reason: routeResult.reason };
  }
  if (routeResult.kind !== "article_created") {
    return { kind: "error", error: "unexpected_routing_result" };
  }

  const triggerResult = await triggerWithPreRunId({
    pipelineName: "article:blog",
    projectId: project.id,
    uniqueKey: { field: "articleId", value: routeResult.articleId },
    costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
    extraInput: { articleId: routeResult.articleId, briefId: brief.id },
    enqueue: enqueueBlogGenerationPipeline,
  });

  if ("error" in triggerResult) {
    return { kind: "error", error: triggerResult.error };
  }

  log.info(
    { briefId: brief.id, articleId: routeResult.articleId, projectId: project.id, dispatch: "immediate" },
    "brief approved (immediate)",
  );

  return { kind: "success", runId: triggerResult.runId, jobId: triggerResult.jobId };
}

/**
 * Spec 65.10 — Approve a `source='recurring'` brief.
 *
 * Recurring briefs are structurally different from gap_analysis / trend_discovery:
 * they're standalone (no cluster), arrive pre-seeded as `plan_pending` from the
 * 65.5 cron worker, and the V1-launch-critical UX is "Marcel clicks approve,
 * carousel renders ~30-40s later". The legacy cluster gate doesn't apply.
 *
 * - `dispatch='plan'` is a near-no-op: the brief is already `plan_pending` so
 *   we return `plan_queued` for API-surface consistency. (If the brief is
 *   somehow `pending`, flip it to `plan_pending` first.)
 * - `dispatch='immediate'` creates the `articles` row via
 *   `createRecurringContentArticle`, flips the brief to `routed`, and enqueues
 *   `article:social-image` with the frozen template-key from
 *   `recurringMetadata.formatConfig.selectedTemplateKey`.
 */
async function approveRecurringBrief(
  brief: typeof topicBriefs.$inferSelect,
  project: Project,
  dispatch: Dispatch,
): Promise<ApproveBriefResult> {
  if (!brief.recurringMetadata) {
    return { kind: "error", error: "recurring brief missing recurringMetadata" };
  }

  if (dispatch === "plan") {
    if (brief.approvalStatus === "plan_pending") {
      // Already queued for the next planner cycle by 65.5 — nothing to do.
      return { kind: "plan_queued" };
    }
    return await markBriefPlanPending(brief.id, project.id);
  }

  // dispatch === "immediate": create article + enqueue render.
  const { articleId } = await db.transaction(async (tx) => {
    const result = await createRecurringContentArticle({ brief, tx });
    await tx
      .update(topicBriefs)
      .set({
        approvalStatus: "routed",
        approvedAt: brief.approvedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(topicBriefs.id, brief.id),
          eq(topicBriefs.projectId, project.id),
          inArray(topicBriefs.approvalStatus, ["pending", "plan_pending"]),
        ),
      );
    return result;
  });

  const formatConfig = brief.recurringMetadata.formatConfig;
  const rawTemplateKey =
    typeof formatConfig === "object" && formatConfig !== null
      ? (formatConfig as Record<string, unknown>).selectedTemplateKey
      : undefined;
  const templateKey = typeof rawTemplateKey === "string" ? rawTemplateKey : undefined;
  const locale = brief.locale === "en" ? "en-US" : "de-DE";

  const triggerResult = await triggerWithPreRunId({
    pipelineName: "article:social-image",
    projectId: project.id,
    uniqueKey: { field: "articleId", value: articleId },
    // Matches the existing social-image trigger in routes/social-posts.ts:
    // ~€0.028 per locale for the merged caption+hashtag Sonnet call.
    costEstimate: { service: "anthropic", estimatedCostEur: 0.028 },
    extraInput: {
      articleId,
      ...(templateKey ? { templateKey } : {}),
      locales: [locale],
    },
    enqueue: (input) =>
      enqueueSocialImagePipeline({
        articleId: input.articleId as string,
        projectId: input.projectId as string,
        theme: "dark",
        variant: "stunning",
        locales: [locale],
        ...(templateKey ? { templateKey } : {}),
        ...(input.preRunId ? { preRunId: input.preRunId as string } : {}),
      }),
  });

  if ("error" in triggerResult) {
    return { kind: "error", error: triggerResult.error };
  }

  log.info(
    {
      briefId: brief.id,
      articleId,
      projectId: project.id,
      templateKey: templateKey ?? null,
      dispatch: "immediate",
    },
    "recurring brief approved (immediate render)",
  );

  return { kind: "success", runId: triggerResult.runId, jobId: triggerResult.jobId };
}

/**
 * Back-compat alias kept for any callers that didn't migrate to `approveBrief`
 * yet. New code should call `approveBrief(id, project, dispatch)`.
 * @deprecated — pass an explicit dispatch via `approveBrief()`.
 */
export async function approveBriefAndEnqueue(
  briefId: string,
  project: Project,
): Promise<ApproveBriefResult> {
  return await approveBrief(briefId, project, "immediate");
}
