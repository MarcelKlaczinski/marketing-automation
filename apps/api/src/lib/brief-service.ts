import { COST_OPS } from "@marketing-auto/core";
import {
  and,
  db,
  eq,
  topicBriefs,
} from "@marketing-auto/db";
import {
  enqueueBlogGenerationPipeline,
  executeDecision,
  type GenerationMode,
  type RoutingDecision,
} from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { triggerWithPreRunId } from "../routes/_lib/trigger-helpers.ts";

const log = createLogger("brief-service");

type Project = { id: string };

type ApproveBriefResult =
  | { kind: "success"; runId: string; jobId: string }
  | { kind: "cluster_assignment_required" }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; error: string };

/**
 * Core approve-and-enqueue logic shared by single-approve and bulk-approve endpoints.
 * Loads the brief by id+projectId, validates it is pending, creates the article row,
 * and enqueues the blog generation pipeline.
 */
export async function approveBriefAndEnqueue(
  briefId: string,
  project: Project,
): Promise<ApproveBriefResult> {
  const [brief] = await db
    .select()
    .from(topicBriefs)
    .where(
      and(
        eq(topicBriefs.id, briefId),
        eq(topicBriefs.projectId, project.id),
        eq(topicBriefs.approvalStatus, "pending"),
      ),
    )
    .limit(1);

  if (!brief) {
    return { kind: "skipped", reason: "not_found_or_not_pending" };
  }

  // create_new briefs require Cluster Creator flow first
  if (brief.clusterAction === "create_new" || !brief.clusterId) {
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

  log.info({ briefId, articleId: routeResult.articleId, projectId: project.id }, "brief approved");

  return { kind: "success", runId: triggerResult.runId, jobId: triggerResult.jobId };
}
