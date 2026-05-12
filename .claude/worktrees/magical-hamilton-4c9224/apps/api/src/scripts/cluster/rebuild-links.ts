#!/usr/bin/env bun
import { clusters, db } from "@marketing-auto/db";
import { enqueueClusterLinkRebuild } from "@marketing-auto/pipelines";
import { eq } from "drizzle-orm";

const clusterName = process.argv[2];
if (!clusterName) {
  console.error("Usage: bun --filter @marketing-auto/api cluster:rebuild-links <cluster-name>");
  process.exit(1);
}

const all = await db.select().from(clusters).where(eq(clusters.name, clusterName));

if (all.length === 0) {
  console.error(`No cluster named "${clusterName}"`);
  process.exit(1);
}
if (all.length > 1) {
  console.error(`Multiple clusters named "${clusterName}". Specify via --project flag.`);
  process.exit(1);
}

const cluster = all[0]!;

const result = await enqueueClusterLinkRebuild({
  clusterId: cluster.id,
  projectId: cluster.projectId,
  triggerType: "manual_cli",
});

console.log(`Cluster link rebuild enqueued
   Cluster: ${cluster.name}
   Run ID:  ${result.runId}
   Job ID:  ${result.jobId}

Pipeline runs sequentially across all published articles in the cluster.
Cost: ~€0.30/article × number of articles.
Each modified article is auto-resynced via Spec 21.`);

process.exit(0);
