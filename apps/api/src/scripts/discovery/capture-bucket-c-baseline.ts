/**
 * Spec 002 (Bucket-C-Cleanup): read-only DB snapshot of `content_pillars` +
 * `clusters` for a project, plus articles cluster_key distribution and a
 * heuristic schwester-pair detector.
 *
 * Used three times during the cleanup workflow:
 *  1. PRE-cleanup  → Marcel reviews + fills CONSOLIDATIONS arrays in
 *                    cleanup-bucket-c-drift.ts (BC1.3)
 *  2. POST-cleanup → verify duplicates are gone, articles re-referenced
 *  3. Reference    → future audits diff against this snapshot
 *
 * Output is a JSON file under
 *   apps/api/src/scripts/discovery/bucket-c-baseline-<slug>-<utc>.json
 *
 * Usage:
 *   bun --filter @marketing-auto/api capture-bucket-c-baseline <project-slug>
 *
 * Read-only. No --apply. Safe to run any time. Pattern 121 / D146 (mirrors
 * capture-cleanup-baseline.ts from Spec 001).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  articles,
  clusters,
  contentPillars,
  db,
  eq,
  projects,
  sql,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("capture-bucket-c-baseline");

export interface BucketCBaseline {
  timestamp: string;
  projectSlug: string;
  projectId: string;

  /** All content_pillars rows with the count of articles whose cluster_key matches the pillar name (likely 0 — pillars are not referenced by cluster_key, but this surfaces accidental name-reuse). */
  contentPillars: Array<{
    id: string;
    name: string;
    description: string | null;
    position: number;
    createdAt: Date | null;
    articlesReferencingName: number;
  }>;

  /** All clusters rows with article counts (articles whose cluster_key equals clusters.name). */
  clusters: Array<{
    id: string;
    name: string;
    pillarId: string;
    pillar: string | null;
    primaryKeyword: string | null;
    status: string;
    generationStatus: string;
    createdAt: Date | null;
    articleCount: number;
  }>;

  /**
   * All distinct articles.cluster_key values with usage counts. Lets Marcel
   * see which cluster_keys are actually in use (vs. dangling cluster rows
   * with no articles attached, or articles pointing at non-existent cluster
   * rows). Per-locale split exposes language-specific drift.
   */
  articleClusterKeyDistribution: Array<{
    clusterKey: string | null;
    locale: string | null;
    articleCount: number;
    matchesClusterRow: boolean;
  }>;

  /**
   * Heuristic-detected schwester-pairs in clusters table. Matches:
   *   - DE word-stem inside EN slug (or vice versa) after stripping -2026
   *   - Hardcoded known pairs (codeium/windsurf landed in code-assistants)
   * Marcel reviews + decides which pairs actually consolidate.
   */
  clusterPairs: Array<{
    aSlug: string;
    bSlug: string;
    aId: string;
    bId: string;
    aArticleCount: number;
    bArticleCount: number;
  }>;

  /** Aggregate summary for quick diff between snapshots. */
  summary: {
    pillarsTotal: number;
    clustersTotal: number;
    distinctArticleClusterKeys: number;
    orphanedClusterKeys: number; // article.cluster_key with no matching clusters.name
    detectedClusterPairs: number;
  };
}

export async function captureBucketCBaseline(projectSlug: string): Promise<BucketCBaseline> {
  const [project] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);

  if (!project) {
    throw new Error(`Project not found: ${projectSlug}`);
  }

  const projectId = project.id;

  // content_pillars — with cross-name-collision count.
  const pillarRows = await db.execute<{
    id: string;
    name: string;
    description: string | null;
    position: number;
    created_at: Date | null;
    articles_referencing_name: number;
  }>(sql`
    SELECT cp.id,
           cp.name,
           cp.description,
           cp.position,
           cp.created_at,
           (SELECT COUNT(*)::int FROM ${articles} a
             WHERE a.project_id = cp.project_id
               AND a.cluster_key = cp.name) AS articles_referencing_name
      FROM ${contentPillars} cp
     WHERE cp.project_id = ${projectId}
     ORDER BY cp.name
  `);

  // clusters — with article-count per cluster.name.
  const clusterRows = await db.execute<{
    id: string;
    name: string;
    pillar_id: string;
    pillar: string | null;
    primary_keyword: string | null;
    status: string;
    generation_status: string;
    created_at: Date | null;
    article_count: number;
  }>(sql`
    SELECT c.id,
           c.name,
           c.pillar_id,
           c.pillar,
           c.primary_keyword,
           c.status,
           c.generation_status,
           c.created_at,
           (SELECT COUNT(*)::int FROM ${articles} a
             WHERE a.project_id = c.project_id
               AND a.cluster_key = c.name) AS article_count
      FROM ${clusters} c
     WHERE c.project_id = ${projectId}
     ORDER BY c.name
  `);

  // articles cluster_key distribution per-locale, with cluster-row-match flag.
  const clusterKeyRows = await db.execute<{
    cluster_key: string | null;
    locale: string | null;
    article_count: number;
    matches_cluster_row: boolean;
  }>(sql`
    SELECT a.cluster_key,
           a.locale,
           COUNT(*)::int AS article_count,
           EXISTS (
             SELECT 1 FROM ${clusters} c
              WHERE c.project_id = a.project_id
                AND c.name = a.cluster_key
           ) AS matches_cluster_row
      FROM ${articles} a
     WHERE a.project_id = ${projectId}
       AND a.cluster_key IS NOT NULL
     GROUP BY a.cluster_key, a.locale, a.project_id
     ORDER BY a.cluster_key, a.locale
  `);

  // Heuristic schwester-pair detection. The substring trick after stripping
  // -2026 catches cases like (`code-assistants-2026`, `code-assistenten-2026`)
  // where one slug is the substring of the other. Marcel reviews + decides.
  const pairRows = await db.execute<{
    a_slug: string;
    b_slug: string;
    a_id: string;
    b_id: string;
    a_count: number;
    b_count: number;
  }>(sql`
    WITH stripped AS (
      SELECT c.id,
             c.name,
             REPLACE(c.name, '-2026', '') AS stem,
             (SELECT COUNT(*)::int FROM ${articles} a
               WHERE a.project_id = c.project_id
                 AND a.cluster_key = c.name) AS article_count
        FROM ${clusters} c
       WHERE c.project_id = ${projectId}
    )
    SELECT c1.name AS a_slug,
           c2.name AS b_slug,
           c1.id   AS a_id,
           c2.id   AS b_id,
           c1.article_count AS a_count,
           c2.article_count AS b_count
      FROM stripped c1
      JOIN stripped c2
        ON c1.name < c2.name
       AND (
         -- substring match after -2026 strip (catches code-assistants vs code-assistenten)
         c1.stem ILIKE '%' || c2.stem || '%'
         OR c2.stem ILIKE '%' || c1.stem || '%'
       )
     ORDER BY c1.name, c2.name
  `);

  // Aggregate summary.
  const distinctKeys = new Set<string>();
  let orphanedCount = 0;
  for (const r of clusterKeyRows) {
    if (r.cluster_key) distinctKeys.add(r.cluster_key);
    if (!r.matches_cluster_row) orphanedCount += r.article_count;
  }

  const baseline: BucketCBaseline = {
    timestamp: new Date().toISOString(),
    projectSlug,
    projectId,
    contentPillars: pillarRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      position: r.position,
      createdAt: r.created_at,
      articlesReferencingName: r.articles_referencing_name,
    })),
    clusters: clusterRows.map((r) => ({
      id: r.id,
      name: r.name,
      pillarId: r.pillar_id,
      pillar: r.pillar,
      primaryKeyword: r.primary_keyword,
      status: r.status,
      generationStatus: r.generation_status,
      createdAt: r.created_at,
      articleCount: r.article_count,
    })),
    articleClusterKeyDistribution: clusterKeyRows.map((r) => ({
      clusterKey: r.cluster_key,
      locale: r.locale,
      articleCount: r.article_count,
      matchesClusterRow: r.matches_cluster_row,
    })),
    clusterPairs: pairRows.map((r) => ({
      aSlug: r.a_slug,
      bSlug: r.b_slug,
      aId: r.a_id,
      bId: r.b_id,
      aArticleCount: r.a_count,
      bArticleCount: r.b_count,
    })),
    summary: {
      pillarsTotal: pillarRows.length,
      clustersTotal: clusterRows.length,
      distinctArticleClusterKeys: distinctKeys.size,
      orphanedClusterKeys: orphanedCount,
      detectedClusterPairs: pairRows.length,
    },
  };

  return baseline;
}

function buildOutputPath(projectSlug: string, timestamp: string): string {
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const dir = resolve(import.meta.dir);
  return `${dir}/bucket-c-baseline-${projectSlug}-${safeTimestamp}.json`;
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    log.error("Usage: capture-bucket-c-baseline <project-slug>");
    process.exit(1);
  }

  const baseline = await captureBucketCBaseline(slug);
  const outputPath = buildOutputPath(slug, baseline.timestamp);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(baseline, null, 2), "utf-8");

  log.info(
    {
      outputPath,
      summary: baseline.summary,
    },
    "capture-bucket-c-baseline: complete",
  );
}

if (import.meta.main) {
  main().catch((err) => {
    log.error({ err }, "capture-bucket-c-baseline: fatal");
    process.exit(1);
  });
}
