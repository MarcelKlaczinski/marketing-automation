import { createLogger } from "@marketing-auto/shared";
import { db, sql } from "@marketing-auto/db";
import { voyage } from "@marketing-auto/adapter-voyage";
import type { ClusterMatchResult, SynthesisTopic } from "./types.ts";

const log = createLogger("trend-discovery:cluster-match");

// ─── Cluster lazy backfill ────────────────────────────────────────────────────

/**
 * Backfill embeddings for any clusters in the project that have null embedding.
 * Runs once per synthesis run so matching has full coverage.
 * Skips gracefully on Voyage API errors.
 */
async function backfillClusterEmbeddings(
  projectId: string,
  pipelineRunId: string | undefined,
): Promise<void> {
  const rows = await db.execute<{ id: string; name: string; primary_keyword: string | null }>(
    sql`SELECT id, name, primary_keyword FROM clusters
        WHERE project_id = ${projectId} AND embedding IS NULL`,
  );

  if (rows.length === 0) return;

  log.info({ projectId, count: rows.length }, "backfilling cluster embeddings");

  for (const row of rows) {
    const text = [row.name, row.primary_keyword].filter(Boolean).join(" — ");
    if (!text) continue;

    try {
      const embedding = await voyage.embed(text, {
        projectId,
        operation: "cluster-match-backfill",
        ...(pipelineRunId !== undefined && { pipelineRunId }),
      });

      await db.execute(sql`
        UPDATE clusters
        SET embedding = ${JSON.stringify(embedding)}::vector
        WHERE id = ${row.id}
      `);
    } catch (e) {
      log.warn({ err: e, clusterId: row.id }, "failed to backfill cluster embedding — skipping");
    }
  }
}

// ─── Main: findMatchingCluster ────────────────────────────────────────────────

const CLUSTER_MATCH_THRESHOLD = 0.65;

export type FindMatchingClusterInput = {
  projectId: string;
  candidate: SynthesisTopic;
  pipelineRunId?: string;
};

/**
 * Find the best-matching cluster for a topic candidate using cosine similarity.
 *
 * Algorithm:
 *  1. Backfill any clusters that lack embeddings (lazy, ~once per cluster lifetime)
 *  2. Embed the candidate title + primary keyword
 *  3. SQL: find top 1 cluster by cosine similarity
 *  4. similarity > 0.65 → matched (cluster_action = 'append_to_existing')
 *     similarity ≤ 0.65 → no match (cluster_action = 'create_new')
 *
 * Returns `ClusterMatchResult`:
 *  - `{ matched: true, clusterId, similarity }` if a cluster is found
 *  - `{ matched: false }` if no cluster has sufficient similarity
 */
export async function findMatchingCluster(
  input: FindMatchingClusterInput,
): Promise<ClusterMatchResult> {
  const { projectId, candidate, pipelineRunId } = input;

  // Backfill before querying so the HNSW index has maximum coverage
  await backfillClusterEmbeddings(projectId, pipelineRunId);

  const candidateText = `${candidate.topic_title} ${candidate.primary_keyword}`.trim();

  let candidateEmbedding: number[];
  try {
    candidateEmbedding = await voyage.embed(candidateText, {
      projectId,
      operation: "cluster-match-candidate",
      ...(pipelineRunId !== undefined && { pipelineRunId }),
    });
  } catch (e) {
    log.warn({ err: e, candidateTitle: candidate.topic_title }, "failed to embed candidate for cluster match — returning no match");
    return { matched: false };
  }

  const embeddingLiteral = JSON.stringify(candidateEmbedding);
  const rows = await db.execute<{
    id: string;
    name: string;
    similarity: string;
  }>(sql`
    SELECT
      id,
      name,
      (1 - (embedding <=> ${embeddingLiteral}::vector))::text AS similarity
    FROM clusters
    WHERE project_id = ${projectId}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingLiteral}::vector
    LIMIT 1
  `);

  if (rows.length === 0) {
    log.debug({ projectId, candidateTitle: candidate.topic_title }, "cluster match: no clusters with embeddings — no match");
    return { matched: false };
  }

  const topRow = rows[0]!;
  const rawSim = parseFloat(topRow.similarity);
  // pgvector returns NaN for zero-norm vectors — treat as 0
  const similarity = isNaN(rawSim) ? 0 : rawSim;

  if (similarity > CLUSTER_MATCH_THRESHOLD) {
    log.debug(
      { candidateTitle: candidate.topic_title, clusterId: topRow.id, clusterName: topRow.name, similarity },
      "cluster match: found"
    );
    return { matched: true, clusterId: topRow.id, similarity };
  }

  log.debug(
    { candidateTitle: candidate.topic_title, topClusterName: topRow.name, similarity, threshold: CLUSTER_MATCH_THRESHOLD },
    "cluster match: best similarity below threshold — no match"
  );
  return { matched: false };
}
