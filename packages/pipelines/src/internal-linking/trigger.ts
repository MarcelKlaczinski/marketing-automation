import { db, linkRebuildRuns } from "@marketing-auto/db";
import { enqueuePipeline } from "../engine/queue.ts";

export async function enqueueClusterLinkRebuild(input: {
  clusterId: string;
  projectId: string;
  triggerType: "auto_after_sync" | "manual_cli" | "manual_http";
  triggeringArticleId?: string;
}): Promise<{ jobId: string; runId: string }> {
  const [run] = await db.insert(linkRebuildRuns).values({
    projectId: input.projectId,
    clusterId: input.clusterId,
    triggeringArticleId: input.triggeringArticleId ?? null,
    triggerType: input.triggerType,
    status: "pending",
  }).returning();

  const { jobId } = await enqueuePipeline({
    pipelineName: "cluster:link-rebuild",
    projectId: input.projectId,
    input: {
      clusterId: input.clusterId,
      projectId: input.projectId,
      triggeringArticleId: input.triggeringArticleId ?? null,
      triggerType: input.triggerType,
      linkRebuildRunId: run!.id,
    },
    // jobId dedup: if sync triggers multiple rebuilds for the same cluster in quick
    // succession, BullMQ keeps only one job — prevents runaway rebuild chains.
    jobOptions: { jobId: `link-rebuild-${input.clusterId}` },
  });

  return { jobId, runId: run!.id };
}
