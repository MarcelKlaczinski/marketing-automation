import { publishPipelineEvent } from "@marketing-auto/core/events";
import { articles, clusters, db, eq, and, isNotNull, pipelineRuns, projects, sql } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("pipelines:cluster-check-completion");

/**
 * Called from BlogPipeline.afterComplete whenever an article with a clusterGenerationId finishes.
 * Transitions clusters.generation_status to 'completed' or 'partial' when all runs are settled.
 */
export async function checkClusterCompletion(input: {
  clusterId: string;
  projectId: string;
}): Promise<void> {
  const { clusterId, projectId } = input;

  const [cluster] = await db
    .select({
      generationStatus: clusters.generationStatus,
      proposedSpokes: clusters.proposedSpokes,
    })
    .from(clusters)
    .where(eq(clusters.id, clusterId))
    .limit(1);

  if (!cluster) return;
  if (cluster.generationStatus !== "running") return;

  const spokeCount = (cluster.proposedSpokes ?? []).length;
  const deArticleCount = 1 + spokeCount; // Hub + Spokes (DE)

  // Determine if EN translations are expected
  const [project] = await db
    .select({ targetLocales: projects.targetLocales, translationAutoTrigger: projects.translationAutoTrigger })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const hasTranslation =
    (project?.targetLocales ?? []).includes("en-US") && (project?.translationAutoTrigger ?? true);
  const expectedTotal = hasTranslation ? deArticleCount * 2 : deArticleCount;

  // Count articles in this cluster that have body content (proxy for "generation complete")
  const generatedArticles = await db
    .select({ id: articles.id })
    .from(articles)
    .where(
      and(
        eq(articles.clusterId, clusterId),
        eq(articles.source, "generated"),
        isNotNull(articles.bodyMd),
      ),
    );

  // Count failed pipeline_runs for this cluster
  const failedRuns = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(
      and(
        sql`${pipelineRuns.input}->>'clusterGenerationId' = ${clusterId}`,
        eq(pipelineRuns.status, "failed"),
      ),
    );

  const generatedCount = generatedArticles.length;
  const failedCount = failedRuns.length;

  log.info(
    { clusterId, expectedTotal, generatedCount, failedCount },
    "checking cluster completion",
  );

  if (generatedCount >= expectedTotal && failedCount === 0) {
    await db
      .update(clusters)
      .set({ generationStatus: "completed", status: "active" })
      .where(and(eq(clusters.id, clusterId), eq(clusters.generationStatus, "running")));
    log.info({ clusterId }, "cluster generation completed");
    void publishPipelineEvent(projectId, {
      type: "cluster.status.changed",
      clusterId,
      oldStatus: "running",
      newStatus: "completed",
      timestamp: new Date().toISOString(),
    });
  } else if (failedCount > 0 && generatedCount + failedCount >= expectedTotal) {
    // All runs have settled (some failed)
    await db
      .update(clusters)
      .set({ generationStatus: "partial" })
      .where(and(eq(clusters.id, clusterId), eq(clusters.generationStatus, "running")));
    log.info({ clusterId, failedCount }, "cluster generation partially completed");
    void publishPipelineEvent(projectId, {
      type: "cluster.status.changed",
      clusterId,
      oldStatus: "running",
      newStatus: "partial",
      timestamp: new Date().toISOString(),
    });
  }
  // Else: still running — leave status unchanged
}
