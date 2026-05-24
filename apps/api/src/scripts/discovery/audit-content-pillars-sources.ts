/**
 * Spec Bucket-D BD3.2 — read-only audit of `content_pillars` rows + their
 * provenance for a project.
 *
 * Per the BD3 patch (2026-05-24): Cluster-Toolification is approved as the
 * refactor path that obsoletes `content_pillars`, so this script captures
 * baseline state as input material for the future Cluster-Toolification
 * implementation. It does NOT propose a fix.
 *
 * Outputs:
 *  - Per row: id, name, description, created_at, position, articlesByCategory
 *    (articles whose `category` equals the pillar's `name`),
 *    articlesByClusterKey (heuristic — pillars are not referenced by
 *    cluster_key, but surfaces accidental name reuse).
 *  - Pillars-as-categories vs. as-cluster-keys distribution.
 *  - A JSON snapshot under
 *    apps/api/src/scripts/discovery/content-pillars-state-<utc>.json
 *
 * Usage:
 *   bun --filter @marketing-auto/api audit-content-pillars-sources <project-slug>
 *
 * Read-only. No --apply. Pattern 121 / D146. Mirrors the
 * `capture-bucket-c-baseline.ts` shape.
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { articles, contentPillars, db, eq, projects, sql } from "@marketing-auto/db";

interface PillarRow {
  id: string;
  name: string;
  description: string | null;
  position: number;
  createdAt: Date | null;
  articlesByCategory: number;
  articlesByClusterKey: number;
}

interface AuditOutput {
  timestamp: string;
  projectSlug: string;
  projectId: string;
  totalPillars: number;
  pillarsWithArticles: number;
  pillarsWithoutArticles: number;
  pillars: PillarRow[];
  /** Top 20 distinct category values among imported articles for this project (sanity-check vs. pillar names). */
  importedArticleCategories: Array<{ category: string | null; count: number }>;
  /** Top 20 distinct cluster_key values among imported articles. */
  importedArticleClusterKeys: Array<{ clusterKey: string | null; count: number }>;
}

async function main() {
  const projectSlug = process.argv[2];
  if (!projectSlug) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.error("usage: audit-content-pillars-sources <project-slug>");
    process.exit(1);
  }

  const [project] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.error(`✗ project '${projectSlug}' not found`);
    process.exit(1);
  }

  // ── Pillar rows + article fan-out counts ─────────────────────────────────
  const pillarRows = await db
    .select({
      id: contentPillars.id,
      name: contentPillars.name,
      description: contentPillars.description,
      position: contentPillars.position,
      createdAt: contentPillars.createdAt,
      articlesByCategory: sql<number>`(
        SELECT count(*)::int FROM ${articles}
        WHERE ${articles.projectId} = ${project.id}
          AND ${articles.category} = ${contentPillars.name}
      )`,
      articlesByClusterKey: sql<number>`(
        SELECT count(*)::int FROM ${articles}
        WHERE ${articles.projectId} = ${project.id}
          AND ${articles.clusterKey} = ${contentPillars.name}
      )`,
    })
    .from(contentPillars)
    .where(eq(contentPillars.projectId, project.id))
    .orderBy(contentPillars.name);

  const pillars: PillarRow[] = pillarRows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    position: r.position,
    createdAt: r.createdAt,
    articlesByCategory: r.articlesByCategory,
    articlesByClusterKey: r.articlesByClusterKey,
  }));

  const pillarsWithArticles = pillars.filter(
    (p) => p.articlesByCategory > 0 || p.articlesByClusterKey > 0,
  ).length;
  const pillarsWithoutArticles = pillars.length - pillarsWithArticles;

  // ── Distinct categories + clusterKeys on imported articles ───────────────
  const catRows = await db
    .select({
      category: articles.category,
      count: sql<number>`count(*)::int`,
    })
    .from(articles)
    .where(eq(articles.projectId, project.id))
    .groupBy(articles.category)
    .orderBy(sql`count(*) DESC`)
    .limit(20);

  const ckRows = await db
    .select({
      clusterKey: articles.clusterKey,
      count: sql<number>`count(*)::int`,
    })
    .from(articles)
    .where(eq(articles.projectId, project.id))
    .groupBy(articles.clusterKey)
    .orderBy(sql`count(*) DESC`)
    .limit(20);

  // ── Stdout summary ───────────────────────────────────────────────────────
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`\n# audit: content_pillars for project=${project.slug}\n`);
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`total pillars: ${pillars.length}`);
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(
    `  with articles referencing them (by category OR cluster_key): ${pillarsWithArticles}`,
  );
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`  with NO articles referencing them: ${pillarsWithoutArticles}`);

  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`\n## pillars`);
  for (const p of pillars) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(
      `  [${p.position.toString().padStart(2, "0")}] ${p.name}  byCategory=${p.articlesByCategory}  byClusterKey=${p.articlesByClusterKey}  desc="${(p.description ?? "").slice(0, 60)}"`,
    );
  }

  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`\n## top categories on imported articles (project-wide)`);
  for (const c of catRows) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(`  ${c.count.toString().padStart(4)} × ${c.category ?? "(NULL)"}`);
  }

  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`\n## top cluster_keys on imported articles (project-wide)`);
  for (const ck of ckRows) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(`  ${ck.count.toString().padStart(4)} × ${ck.clusterKey ?? "(NULL)"}`);
  }

  // ── JSON snapshot ────────────────────────────────────────────────────────
  const output: AuditOutput = {
    timestamp: new Date().toISOString(),
    projectSlug: project.slug,
    projectId: project.id,
    totalPillars: pillars.length,
    pillarsWithArticles,
    pillarsWithoutArticles,
    pillars,
    importedArticleCategories: catRows.map((r) => ({
      category: r.category,
      count: r.count,
    })),
    importedArticleClusterKeys: ckRows.map((r) => ({
      clusterKey: r.clusterKey,
      count: r.count,
    })),
  };
  const ts = output.timestamp.replace(/[:.]/g, "-");
  const filename = resolve(
    import.meta.dir,
    `content-pillars-state-${project.slug}-${ts}.json`,
  );
  await writeFile(filename, JSON.stringify(output, null, 2));
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`\n→ snapshot: ${filename}`);

  process.exit(0);
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.error("✗ audit failed:", err);
  process.exit(1);
});
