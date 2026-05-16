import { publishPipelineEvent } from "@marketing-auto/core/events";
import { articles, clusters, db, eq } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { enqueueBlogGeneration } from "../../article/blog/trigger.ts";

const log = createLogger("pipelines:cluster-enqueue-spokes");

/**
 * Called from BlogPipeline.afterComplete when the Hub article finishes.
 * Enqueues all pending spoke briefs in parallel — BullMQ handles concurrency.
 * Sets pillarArticleId on the cluster so spoke pipelines have the Hub as voice reference.
 */
export async function enqueueClusterSpokes(input: {
  clusterId: string;
  hubArticleId: string;
}): Promise<void> {
  const { clusterId, hubArticleId } = input;

  const [cluster] = await db
    .select({
      id: clusters.id,
      projectId: clusters.projectId,
      pendingSpokeBriefIds: clusters.pendingSpokeBriefIds,
      generationStatus: clusters.generationStatus,
    })
    .from(clusters)
    .where(eq(clusters.id, clusterId))
    .limit(1);

  if (!cluster) {
    log.warn({ clusterId }, "enqueueClusterSpokes: cluster not found");
    return;
  }

  const spokeBriefIds = cluster.pendingSpokeBriefIds ?? [];
  if (spokeBriefIds.length === 0) {
    log.info({ clusterId }, "enqueueClusterSpokes: no pending spoke briefs — skipping");
    return;
  }

  // Set Hub as the pillar article before spokes start (enables voice continuity via Voice-Reference Loader)
  await db
    .update(clusters)
    .set({ pillarArticleId: hubArticleId, pendingSpokeBriefIds: [] })
    .where(eq(clusters.id, clusterId));

  log.info({ clusterId, hubArticleId, spokeCount: spokeBriefIds.length }, "enqueueing cluster spokes");

  void publishPipelineEvent(cluster.projectId, {
    type: "cluster.status.changed",
    clusterId,
    oldStatus: "running",
    newStatus: "running", // still running, but hub is done — UI can update spoke list
    timestamp: new Date().toISOString(),
  });

  // Enqueue all spoke briefs in parallel
  await Promise.allSettled(
    spokeBriefIds.map(async (briefId) => {
      try {
        const { articleId } = await enqueueBlogGeneration({
          briefId,
          projectId: cluster.projectId,
        });

        // Set clusterGenerationId + role on the spoke article (created by enqueueBlogGeneration)
        await db
          .update(articles)
          .set({ clusterGenerationId: clusterId, role: "spoke" })
          .where(eq(articles.id, articleId));

        log.info({ clusterId, briefId, articleId }, "spoke enqueued");
      } catch (e) {
        log.warn({ err: e, clusterId, briefId }, "failed to enqueue spoke — will surface as partial failure");
      }
    }),
  );

}
