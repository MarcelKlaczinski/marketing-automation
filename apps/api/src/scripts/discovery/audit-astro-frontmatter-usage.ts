/**
 * Spec Bucket-D BD1.2 — read-only audit of `articles.astro_frontmatter` usage
 * cross-tenant + per-source.
 *
 * Confirms the audit hypothesis that `astro_frontmatter` is populated only by
 * the generation-side `UpdateDbStatusStep` (Spec 21), never by the importer
 * `UpsertArticlesStep` — so every imported row stays NULL forever. Output
 * informs BD1.3 outcome classification (dead column vs by-design dormant).
 *
 * Output: stdout summary + optional JSON snapshot under
 *   apps/api/src/scripts/discovery/astro-frontmatter-usage-<utc>.json
 *
 * Usage:
 *   bun --filter @marketing-auto/api audit-astro-frontmatter-usage [--project=<slug>] [--json]
 *
 * Read-only. No --apply. Safe to run any time. Pattern 121 / D146.
 */

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { articles, db, eq, projects, sql } from "@marketing-auto/db";

interface PerProjectRow {
  projectSlug: string;
  projectId: string;
  total: number;
  populatedNotEmpty: number;
  populatedEmpty: number;
  nullCount: number;
  imported: { total: number; populated: number };
  generated: { total: number; populated: number };
}

interface AuditOutput {
  timestamp: string;
  scope: { projectSlug: string | null };
  perProject: PerProjectRow[];
  samples: Array<{
    projectSlug: string;
    slug: string;
    collection: string;
    locale: string;
    source: string;
    keyCount: number;
    keys: string[];
  }>;
}

function parseArgs(): { projectSlug: string | null; writeJson: boolean } {
  const args = process.argv.slice(2);
  let projectSlug: string | null = null;
  let writeJson = false;
  for (const arg of args) {
    if (arg.startsWith("--project=")) {
      projectSlug = arg.slice("--project=".length);
    } else if (arg === "--json") {
      writeJson = true;
    }
  }
  return { projectSlug, writeJson };
}

async function main() {
  const { projectSlug, writeJson } = parseArgs();

  // Resolve project filter to id (or null = all projects)
  let projectFilter: { id: string; slug: string } | null = null;
  if (projectSlug) {
    const found = await db
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .where(eq(projects.slug, projectSlug))
      .limit(1);
    if (found.length === 0) {
      // biome-ignore lint/suspicious/noConsoleLog: script output
      console.error(`✗ project '${projectSlug}' not found`);
      process.exit(1);
    }
    projectFilter = found[0]!;
  }

  // ── Aggregate query: counts per project + per source ─────────────────────
  const baseWhere = projectFilter ? eq(articles.projectId, projectFilter.id) : undefined;

  const rows = await db
    .select({
      projectId: articles.projectId,
      projectSlug: projects.slug,
      total: sql<number>`count(*)::int`,
      populatedNotEmpty: sql<number>`count(*) FILTER (WHERE ${articles.astroFrontmatter} IS NOT NULL AND ${articles.astroFrontmatter}::text != '{}'::text)::int`,
      populatedEmpty: sql<number>`count(*) FILTER (WHERE ${articles.astroFrontmatter} IS NOT NULL AND ${articles.astroFrontmatter}::text = '{}'::text)::int`,
      nullCount: sql<number>`count(*) FILTER (WHERE ${articles.astroFrontmatter} IS NULL)::int`,
      importedTotal: sql<number>`count(*) FILTER (WHERE ${articles.source} = 'imported')::int`,
      importedPopulated: sql<number>`count(*) FILTER (WHERE ${articles.source} = 'imported' AND ${articles.astroFrontmatter} IS NOT NULL)::int`,
      generatedTotal: sql<number>`count(*) FILTER (WHERE ${articles.source} = 'generated')::int`,
      generatedPopulated: sql<number>`count(*) FILTER (WHERE ${articles.source} = 'generated' AND ${articles.astroFrontmatter} IS NOT NULL)::int`,
    })
    .from(articles)
    .innerJoin(projects, eq(projects.id, articles.projectId))
    .where(baseWhere)
    .groupBy(articles.projectId, projects.slug)
    .orderBy(projects.slug);

  const perProject: PerProjectRow[] = rows.map((r) => ({
    projectSlug: r.projectSlug,
    projectId: r.projectId,
    total: r.total,
    populatedNotEmpty: r.populatedNotEmpty,
    populatedEmpty: r.populatedEmpty,
    nullCount: r.nullCount,
    imported: { total: r.importedTotal, populated: r.importedPopulated },
    generated: { total: r.generatedTotal, populated: r.generatedPopulated },
  }));

  // ── Sample populated rows for spot-check (max 5 per project) ─────────────
  const samples: AuditOutput["samples"] = [];
  for (const p of perProject) {
    if (p.populatedNotEmpty === 0) continue;
    const sampleRows = await db
      .select({
        slug: articles.slug,
        collection: articles.collection,
        locale: articles.locale,
        source: articles.source,
        keys: sql<string[]>`(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(${articles.astroFrontmatter}) AS k)`,
        keyCount: sql<number>`(SELECT count(*)::int FROM jsonb_object_keys(${articles.astroFrontmatter}))`,
      })
      .from(articles)
      .where(
        sql`${articles.projectId} = ${p.projectId} AND ${articles.astroFrontmatter} IS NOT NULL AND ${articles.astroFrontmatter}::text != '{}'::text`,
      )
      .limit(5);
    for (const r of sampleRows) {
      samples.push({
        projectSlug: p.projectSlug,
        slug: r.slug,
        collection: r.collection,
        locale: r.locale,
        source: r.source,
        keyCount: r.keyCount,
        keys: r.keys ?? [],
      });
    }
  }

  // ── Stdout report ────────────────────────────────────────────────────────
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`\n# audit: articles.astro_frontmatter usage\n`);
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(
    `scope: ${projectFilter ? `project=${projectFilter.slug}` : "ALL projects"}\n`,
  );

  for (const p of perProject) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(`## ${p.projectSlug}`);
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(
      `  total=${p.total}  populated-non-empty=${p.populatedNotEmpty}  populated-empty={}=${p.populatedEmpty}  NULL=${p.nullCount}`,
    );
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(
      `  by source: imported=${p.imported.populated}/${p.imported.total}  generated=${p.generated.populated}/${p.generated.total}`,
    );
  }

  if (samples.length > 0) {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(`\n## sample populated rows (max 5 per project)`);
    for (const s of samples) {
      // biome-ignore lint/suspicious/noConsoleLog: script output
      console.log(
        `  [${s.projectSlug}] ${s.collection}/${s.locale}/${s.slug}  source=${s.source}  keys(${s.keyCount}): ${s.keys.slice(0, 12).join(", ")}${s.keys.length > 12 ? ", …" : ""}`,
      );
    }
  } else {
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(`\nNo populated rows found across the audited scope.`);
  }

  // ── Optional JSON snapshot ───────────────────────────────────────────────
  if (writeJson) {
    const output: AuditOutput = {
      timestamp: new Date().toISOString(),
      scope: { projectSlug: projectFilter?.slug ?? null },
      perProject,
      samples,
    };
    const ts = output.timestamp.replace(/[:.]/g, "-");
    const filename = resolve(
      import.meta.dir,
      `astro-frontmatter-usage-${ts}.json`,
    );
    await writeFile(filename, JSON.stringify(output, null, 2));
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(`\n→ snapshot: ${filename}`);
  }

  process.exit(0);
}

main().catch((err) => {
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.error("✗ audit failed:", err);
  process.exit(1);
});
