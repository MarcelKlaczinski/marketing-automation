import { db, sql } from "@marketing-auto/db";
import type { HistoricScoreRow } from "./types.ts";

/**
 * Score authors by how often they've written blog articles matching the given
 * clusterId and/or intentType. Returns top-5 by score descending.
 *
 * Score = (matchedOnCluster × 3) + (matchedOnIntent × 2) + (totalPosts × 0.1)
 *
 * Matches on articles.cluster_id (UUID FK) rather than cluster_key (frontmatter text)
 * since the FK is set reliably by the import sync step for historical articles.
 *
 * Only considers imported historical articles (source='imported') to avoid
 * circular feedback from AI-generated posts. Excludes org-placeholder authors
 * (slug like 'toolwiki%').
 */
export async function historicAuthorScore(
  projectId: string,
  clusterId: string | null,
  intentType: string | null,
  locale: "de" | "en",
): Promise<HistoricScoreRow[]> {
  const rows = await db.execute<{
    slug: string;
    matched_on_cluster: string;
    matched_on_intent: string;
    total_posts: string;
    score: string;
  }>(sql`
    SELECT
      a.author AS slug,
      COUNT(*) FILTER (WHERE a.cluster_id = ${clusterId}::uuid) AS matched_on_cluster,
      COUNT(*) FILTER (WHERE a.intent_type = ${intentType}) AS matched_on_intent,
      COUNT(*) AS total_posts,
      (
        COUNT(*) FILTER (WHERE a.cluster_id = ${clusterId}::uuid) * 3 +
        COUNT(*) FILTER (WHERE a.intent_type = ${intentType}) * 2 +
        COUNT(*) * 0.1
      ) AS score
    FROM articles a
    WHERE a.project_id = ${projectId}::uuid
      AND a.collection = 'blog'
      AND a.source = 'imported'
      AND a.author IS NOT NULL
      AND a.author NOT LIKE 'toolwiki%'
      AND a.locale = ${locale}
    GROUP BY a.author
    HAVING COUNT(*) > 0
    ORDER BY score DESC
    LIMIT 5
  `);

  return rows.map((r) => ({
    slug: r.slug,
    matchedOnCluster: parseInt(r.matched_on_cluster, 10),
    matchedOnIntent: parseInt(r.matched_on_intent, 10),
    totalPosts: parseInt(r.total_posts, 10),
    score: parseFloat(r.score),
  }));
}
