/**
 * Spec 001: capture a read-only DB snapshot for a project's articles state.
 *
 * Used three times during the cleanup workflow:
 *  1. PRE-cleanup  → reference of orphan candidates + comparison-stale fields
 *  2. POST-cleanup → verify orphans are now `status='superseded'`, comparisons
 *                    have nulled stale fields
 *  3. POST-re-import → verify final inventory matches the forecast (290 total /
 *                      280 active / 0 slug-diff vs. repo)
 *
 * Output is a JSON file under `apps/api/src/scripts/discovery/baseline-<slug>-<utc>.json`.
 * Marcel reviews diffs between snapshots by running this script before and after
 * each mutation step.
 *
 * Usage:
 *   bun --filter @marketing-auto/api capture-cleanup-baseline <project-slug>
 *
 * Read-only. No --apply needed. Safe to run any time.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  and,
  articles,
  db,
  eq,
  inArray,
  isNotNull,
  or,
  projects,
  sql,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("capture-cleanup-baseline");

/**
 * 10 known orphan slugs from `docs/discovery/post-refactor-state-audit.md`:
 *  - 4 Comparison-Migrations (dalle-*, elevenlabs-* × DE+EN)
 *  - 2 Slug-Renames (system-prompts-* → -best-practices-2026)
 *  - 4 Pure Deletions (chatgpt-preise/-pricing-2026, code-assistenten/ai-code-assistants)
 *
 * These rows exist in `articles WHERE collection='blog'` because they were
 * created BEFORE the multi-domain-evolution refactor moved them to other
 * collections / renamed them. The Astro repo no longer contains them, but
 * RepoImportPipeline has no delete-step (see Spec §6 future work).
 */
export const ORPHAN_BLOG_SLUGS = [
  // Comparison-Migrations
  "dalle-4-vs-midjourney-v7-vs-flux-2026-vergleich",
  "dall-e-4-vs-midjourney-v7-vs-flux-2026-comparison",
  "elevenlabs-vs-murf-vs-play-ht-voice-cloning-test-2026",
  "elevenlabs-vs-murf-vs-play-ht-voice-cloning-comparison-2026",
  // Slug-Renames
  "system-prompts-role-prompting-2026-leitfaden",
  "system-prompts-role-prompting-2026-guide",
  // Pure Deletions
  "chatgpt-preise-2026",
  "chatgpt-pricing-2026",
  "code-assistenten",
  "ai-code-assistants",
] as const;

export interface CaptureBaseline {
  timestamp: string;
  projectSlug: string;
  projectId: string;
  // Total articles per (collection, locale, source, status).
  articlesInventory: Array<{
    collection: string | null;
    locale: string | null;
    source: string;
    status: string;
    count: number;
  }>;
  // Each of the 10 orphan-slug candidates with current state.
  orphanBlogs: Array<{
    id: string;
    slug: string;
    locale: string | null;
    status: string;
    collection: string;
    updatedAt: Date | null;
  }>;
  // Comparison rows still carrying stale legacy-Blog fields.
  comparisonsWithStaleFields: Array<{
    id: string;
    slug: string;
    locale: string | null;
    category: string | null;
    publishedAt: Date | null;
    tags: string[] | null;
    tagsLength: number;
  }>;
  // Aggregate counts (for quick diff between snapshots).
  summary: {
    totalArticles: number;
    activeArticles: number;
    supersededArticles: number;
    orphanCandidatesNotSuperseded: number;
    comparisonsWithStaleFieldsCount: number;
  };
}

export async function captureBaseline(projectSlug: string): Promise<CaptureBaseline> {
  const [project] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);

  if (!project) {
    throw new Error(`Project not found: ${projectSlug}`);
  }

  const projectId = project.id;

  // Inventory by (collection, locale, source, status).
  const inventoryRows = await db
    .select({
      collection: articles.collection,
      locale: articles.locale,
      source: articles.source,
      status: articles.status,
      count: sql<number>`count(*)::int`,
    })
    .from(articles)
    .where(eq(articles.projectId, projectId))
    .groupBy(articles.collection, articles.locale, articles.source, articles.status);

  // Orphan candidates (10 known slugs in blog-collection).
  const orphanRows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      locale: articles.locale,
      status: articles.status,
      collection: articles.collection,
      updatedAt: articles.updatedAt,
    })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "blog"),
        inArray(articles.slug, [...ORPHAN_BLOG_SLUGS]),
      ),
    );

  // Comparison rows still carrying stale Blog-era fields.
  // `tags` is text[] (NOT jsonb — schema check) so we use cardinality.
  const staleRows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      locale: articles.locale,
      category: articles.category,
      publishedAt: articles.publishedAt,
      tags: articles.tags,
    })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "comparisons"),
        or(
          isNotNull(articles.category),
          isNotNull(articles.publishedAt),
          sql`(${articles.tags} IS NOT NULL AND cardinality(${articles.tags}) > 0)`,
        ),
      ),
    );

  // Aggregate summary.
  let totalArticles = 0;
  let activeArticles = 0;
  let supersededArticles = 0;
  for (const row of inventoryRows) {
    totalArticles += row.count;
    if (row.status === "superseded") supersededArticles += row.count;
    else activeArticles += row.count;
  }
  const orphanCandidatesNotSuperseded = orphanRows.filter((r) => r.status !== "superseded").length;

  const baseline: CaptureBaseline = {
    timestamp: new Date().toISOString(),
    projectSlug,
    projectId,
    articlesInventory: inventoryRows.map((r) => ({
      collection: r.collection,
      locale: r.locale,
      source: r.source,
      status: r.status,
      count: r.count,
    })),
    orphanBlogs: orphanRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      locale: r.locale,
      status: r.status,
      collection: r.collection,
      updatedAt: r.updatedAt,
    })),
    comparisonsWithStaleFields: staleRows.map((r) => ({
      id: r.id,
      slug: r.slug,
      locale: r.locale,
      category: r.category,
      publishedAt: r.publishedAt,
      tags: r.tags,
      tagsLength: r.tags?.length ?? 0,
    })),
    summary: {
      totalArticles,
      activeArticles,
      supersededArticles,
      orphanCandidatesNotSuperseded,
      comparisonsWithStaleFieldsCount: staleRows.length,
    },
  };

  return baseline;
}

function buildOutputPath(projectSlug: string, timestamp: string): string {
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const dir = resolve(import.meta.dir);
  return `${dir}/baseline-${projectSlug}-${safeTimestamp}.json`;
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    log.error("Usage: capture-cleanup-baseline <project-slug>");
    process.exit(1);
  }

  const baseline = await captureBaseline(slug);
  const outputPath = buildOutputPath(slug, baseline.timestamp);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(baseline, null, 2), "utf-8");

  log.info(
    {
      outputPath,
      summary: baseline.summary,
    },
    "capture-cleanup-baseline: complete",
  );
}

if (import.meta.main) {
  main().catch((err) => {
    log.error({ err }, "capture-cleanup-baseline: fatal");
    process.exit(1);
  });
}
