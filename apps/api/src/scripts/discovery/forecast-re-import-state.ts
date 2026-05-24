/**
 * Spec 001 / C3.1: forecast the expected DB mutations from a Re-Import.
 *
 * Reads:
 *   - `repo-inventory.json` (the committed snapshot of Branch-B's Astro repo —
 *     what RepoImportPipeline will fetch and try to import)
 *   - The live DB (active articles only, status != 'superseded') for the
 *     given project
 *
 * Prints a per-collection × per-locale diff:
 *   - INSERTS:  slugs in repo but not in active DB → become new rows
 *   - UPDATES:  slugs in both sides → frontmatter/body refresh
 *   - DB-ONLY:  active DB slugs the repo no longer has → potential orphans
 *               that the cleanup-post-refactor-drift script must catch
 *
 * Output is text-only (no JSON file) — Marcel reads stdout and signs off on
 * the numbers before triggering POST /api/projects/<slug>/astro-import.
 *
 * Usage:
 *   bun --filter @marketing-auto/api forecast-re-import-state <project-slug>
 *
 * Read-only. Safe to run any time. Re-generate repo-inventory.json (separate
 * script, runs against GitHub) if the committed snapshot is stale.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  and,
  articles,
  db,
  eq,
  ne,
  projects,
  sql,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("forecast-re-import-state");

export interface RepoCollectionInventory {
  collection: string;
  totalFiles: number;
  byLocale?: Record<string, { count: number; slugs: string[] }>;
  /**
   * Spec 006 / F1.5: `scopes?` is an optional per-slug subdirectory map for
   * collections nested one directory deeper than the collection root (e.g.
   * `categories/blog/<slug>.md` → `scopes[slug] = "blog"`). Pure metadata —
   * not consumed by `computeForecastDiff()` today; documented for future
   * disambiguation surfaces.
   */
  noLocaleSplit?: { count: number; slugs: string[]; scopes?: Record<string, string> };
}

export interface DbInventoryRow {
  collection: string;
  locale: string | null;
  source: string;
  count: number;
  slugs: string[];
}

export interface PerLocaleDiff {
  collection: string;
  locale: string | null;
  repoSlugCount: number;
  dbActiveCount: number;
  inserts: string[]; // in repo, not in DB-active
  updates: string[]; // in both
  dbOnly: string[]; // in DB-active, not in repo (potential orphans)
}

export interface ForecastReport {
  generatedAt: string;
  projectSlug: string;
  projectId: string;
  perLocaleDiffs: PerLocaleDiff[];
  summary: {
    totalInserts: number;
    totalUpdates: number;
    totalDbOnly: number;
    perCollection: Record<string, { inserts: number; updates: number; dbOnly: number }>;
  };
}

const REPO_INVENTORY_PATH = resolve(import.meta.dir, "repo-inventory.json");

/**
 * Live DB inventory: active articles only (status != 'superseded') grouped
 * by (collection, locale). We aggregate slugs with `array_agg`. Imported AND
 * generated rows count — Re-Import only touches `source='imported'` ones, but
 * for the diff we care about the full active state so generated-locally rows
 * don't get mis-classified as "DB-only orphans".
 */
async function loadActiveDbInventory(projectId: string): Promise<DbInventoryRow[]> {
  const rows = await db
    .select({
      collection: articles.collection,
      locale: articles.locale,
      source: articles.source,
      count: sql<number>`count(*)::int`,
      slugs: sql<string[]>`array_agg(${articles.slug} ORDER BY ${articles.slug})`,
    })
    .from(articles)
    .where(and(eq(articles.projectId, projectId), ne(articles.status, "superseded")))
    .groupBy(articles.collection, articles.locale, articles.source);

  return rows.map((r) => ({
    collection: r.collection,
    locale: r.locale,
    source: r.source,
    count: r.count,
    slugs: r.slugs,
  }));
}

function diffOne({
  collection,
  locale,
  repoSlugs,
  dbActiveSlugs,
}: {
  collection: string;
  locale: string | null;
  repoSlugs: string[];
  dbActiveSlugs: string[];
}): PerLocaleDiff {
  const repoSet = new Set(repoSlugs);
  const dbSet = new Set(dbActiveSlugs);
  const inserts = [...repoSet].filter((s) => !dbSet.has(s)).sort();
  const updates = [...repoSet].filter((s) => dbSet.has(s)).sort();
  const dbOnly = [...dbSet].filter((s) => !repoSet.has(s)).sort();
  return {
    collection,
    locale,
    repoSlugCount: repoSet.size,
    dbActiveCount: dbSet.size,
    inserts,
    updates,
    dbOnly,
  };
}

/**
 * Pure diff/aggregation. Given the repo inventory and live DB rows, returns
 * the per-locale diffs + summary. Extracted from `forecastReImportState` so
 * smoke tests can exercise the matching rules (Spec 004 F1 in particular)
 * without spinning up a real Postgres connection.
 */
export function computeForecastDiff(
  repoInventory: RepoCollectionInventory[],
  dbInventory: DbInventoryRow[],
): { perLocaleDiffs: PerLocaleDiff[]; summary: ForecastReport["summary"] } {
  // Group DB rows by (collection, locale) regardless of `source` so the diff
  // sees both imported and generated rows. (Re-Import only writes to imported,
  // but generated rows can shadow a repo slug.)
  //
  // Spec 004 / F1 fix: each row also contributes to a `<coll>|_any_locale`
  // bucket so `noLocaleSplit` collections (e.g. `categories`) — which the
  // importer writes with `locale='de'` despite not having a locale split in
  // the Astro repo — get matched against the full set of DB rows for that
  // collection, ignoring the `locale` column.
  const dbByCollLocale = new Map<string, string[]>();
  for (const r of dbInventory) {
    const localeKey = `${r.collection}|${r.locale ?? "_no_locale"}`;
    const anyKey = `${r.collection}|_any_locale`;
    const existingLocale = dbByCollLocale.get(localeKey) ?? [];
    dbByCollLocale.set(localeKey, existingLocale.concat(r.slugs));
    const existingAny = dbByCollLocale.get(anyKey) ?? [];
    dbByCollLocale.set(anyKey, existingAny.concat(r.slugs));
  }

  const perLocaleDiffs: PerLocaleDiff[] = [];

  for (const repoColl of repoInventory) {
    // Spec 004 / F1: prefer `noLocaleSplit` when `byLocale` is absent OR an
    // empty object — `repo-inventory.json` serialises noLocaleSplit entries
    // with `"byLocale": {}` alongside the populated `noLocaleSplit` block,
    // and an empty-object truthy check would otherwise short-circuit this
    // entry into the per-locale branch with zero iterations.
    const hasByLocale =
      repoColl.byLocale && Object.keys(repoColl.byLocale).length > 0;
    if (hasByLocale && repoColl.byLocale) {
      for (const [locale, bucket] of Object.entries(repoColl.byLocale)) {
        const dbSlugs = dbByCollLocale.get(`${repoColl.collection}|${locale}`) ?? [];
        perLocaleDiffs.push(
          diffOne({
            collection: repoColl.collection,
            locale,
            repoSlugs: bucket.slugs,
            dbActiveSlugs: dbSlugs,
          }),
        );
      }
    } else if (repoColl.noLocaleSplit) {
      // Spec 004 / F1: match noLocaleSplit collections against ALL locale
      // values in DB — the importer writes them with `locale='de'` despite
      // the Astro repo having no locale split.
      const dbSlugs = dbByCollLocale.get(`${repoColl.collection}|_any_locale`) ?? [];
      perLocaleDiffs.push(
        diffOne({
          collection: repoColl.collection,
          locale: null,
          repoSlugs: repoColl.noLocaleSplit.slugs,
          dbActiveSlugs: dbSlugs,
        }),
      );
    }
  }

  // Aggregate summary.
  let totalInserts = 0;
  let totalUpdates = 0;
  let totalDbOnly = 0;
  const perCollection: Record<string, { inserts: number; updates: number; dbOnly: number }> = {};
  for (const d of perLocaleDiffs) {
    totalInserts += d.inserts.length;
    totalUpdates += d.updates.length;
    totalDbOnly += d.dbOnly.length;
    const existing = perCollection[d.collection] ?? { inserts: 0, updates: 0, dbOnly: 0 };
    existing.inserts += d.inserts.length;
    existing.updates += d.updates.length;
    existing.dbOnly += d.dbOnly.length;
    perCollection[d.collection] = existing;
  }

  return {
    perLocaleDiffs,
    summary: { totalInserts, totalUpdates, totalDbOnly, perCollection },
  };
}

export async function forecastReImportState(projectSlug: string): Promise<ForecastReport> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, projectSlug))
    .limit(1);
  if (!project) {
    throw new Error(`Project not found: ${projectSlug}`);
  }
  const projectId = project.id;

  const repoInventoryRaw = await readFile(REPO_INVENTORY_PATH, "utf-8");
  const repoInventory: RepoCollectionInventory[] = JSON.parse(repoInventoryRaw);
  const dbInventory = await loadActiveDbInventory(projectId);

  const { perLocaleDiffs, summary } = computeForecastDiff(repoInventory, dbInventory);

  return {
    generatedAt: new Date().toISOString(),
    projectSlug,
    projectId,
    perLocaleDiffs,
    summary,
  };
}

function formatReport(report: ForecastReport): string {
  const lines: string[] = [];
  lines.push(`# Re-Import Forecast — project: ${report.projectSlug}`);
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Total expected INSERTS: ${report.summary.totalInserts}`);
  lines.push(`- Total expected UPDATES: ${report.summary.totalUpdates}`);
  lines.push(`- Active DB rows not in repo (DB-only): ${report.summary.totalDbOnly}`);
  lines.push("");
  lines.push("## Per-collection breakdown");
  for (const [coll, stats] of Object.entries(report.summary.perCollection).sort()) {
    lines.push(
      `- ${coll}: ${stats.inserts} inserts / ${stats.updates} updates / ${stats.dbOnly} DB-only`,
    );
  }
  lines.push("");
  lines.push("## Per-locale detail");
  for (const d of report.perLocaleDiffs) {
    const localeLabel = d.locale ?? "(no-locale)";
    lines.push(`### ${d.collection}/${localeLabel}`);
    lines.push(`  repo files: ${d.repoSlugCount} · DB active: ${d.dbActiveCount}`);
    lines.push(`  inserts (${d.inserts.length}): ${d.inserts.length === 0 ? "—" : d.inserts.join(", ")}`);
    lines.push(
      `  DB-only (${d.dbOnly.length}): ${d.dbOnly.length === 0 ? "—" : d.dbOnly.join(", ")}`,
    );
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    log.error("Usage: forecast-re-import-state <project-slug>");
    process.exit(1);
  }

  const report = await forecastReImportState(slug);
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(formatReport(report));
  log.info(
    {
      projectSlug: report.projectSlug,
      summary: report.summary,
    },
    "forecast-re-import-state: complete",
  );
}

if (import.meta.main) {
  main().catch((err) => {
    log.error({ err }, "forecast-re-import-state: fatal");
    process.exit(1);
  });
}
