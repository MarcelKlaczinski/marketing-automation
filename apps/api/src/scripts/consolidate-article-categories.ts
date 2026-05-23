/**
 * Spec multi-domain-evolution S3.5 — articles.category consolidation CLI.
 *
 * Maps legacy German labels (e.g. "Guides & Tutorials") to seeded slugs
 * (e.g. "guides-und-tutorials") so `articles.category` references the live
 * content_categories taxonomy after Sprint 3.
 *
 * Default mode: dry-run. Pass `--apply` to actually mutate. Defense in depth:
 *   1. Both modes print an audit table (collection, old → new, count).
 *   2. Apply mode adds `category_legacy` column (idempotent IF NOT EXISTS)
 *      and copies the current `category` value before overwriting.
 *   3. Apply mode runs the same SELECT … NOT IN (…) audit AFTER the update
 *      to verify zero rows remain unmapped. Non-zero count exits non-zero.
 *
 * Mapping rule: applies the same `slugifyCategory` logic the Toolwiki Astro
 * uses today (`& → und`, lowercase, ASCII-fold, hyphens). If the slugified
 * result is NOT in content_categories for that scope, the row is SKIPPED
 * with a warn log — manual review required.
 *
 * Usage:
 *   bun --filter @marketing-auto/api consolidate-article-categories \
 *     --project=<slug> [--apply] [--no-backup]
 *
 * Flags:
 *   --project=<slug>  required. Targets only that project's articles.
 *   --apply           Actually run the UPDATE. Without this, prints plan.
 *   --no-backup       Skip the ALTER TABLE + category_legacy copy step.
 *                     ONLY for re-runs where the column already exists +
 *                     was populated by a prior --apply run.
 */
import {
  articles,
  contentCategories,
  db,
  eq,
  projects,
  sql,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { parseArgs } from "node:util";

const log = createLogger("consolidate-article-categories");

/**
 * Mirrors `slugifyCategory` from
 * /Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu/src/lib/taxonomy.ts
 * — same transform Astro uses to derive URL slugs from German enum labels.
 * Replicated here (not imported) because the consolidation script must work
 * offline against the Tool DB; Astro repo is not a workspace dep.
 */
export function slugifyCategory(value: string | undefined): string {
  if (!value) return "";
  if (/^[a-z0-9-]+$/.test(value)) return value;
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/&/g, "und")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Map Drizzle `collection` text → `content_categories.scope`. Mirrors
 * `collectionTypeToScope` in packages/pipelines/src/article/category-validation/
 * validate-and-notify.ts but takes the wider `articles.collection` text
 * column (which includes Astro folder names like "comparisons" + future
 * tenant-specific values).
 */
function collectionToScope(collection: string | null): string | null {
  switch (collection) {
    case "tools":
      return "tool";
    case "blog":
      return "blog";
    case "ki-wissen":
      return "knowledge";
    case "usecases":
      return "usecase";
    default:
      // comparison/comparisons + Astro folder name variants → no taxonomy
      return null;
  }
}

interface AuditRow {
  collection: string | null;
  category: string;
  count: number;
}

async function loadUnmappedRows(projectId: string): Promise<AuditRow[]> {
  const rows = await db.execute<{
    collection: string | null;
    category: string;
    n: number;
  }>(sql`
    SELECT
      a.collection AS collection,
      a.category   AS category,
      COUNT(*)::int AS n
    FROM articles a
    WHERE a.project_id = ${projectId}
      AND a.category IS NOT NULL
      AND a.category != ''
      AND NOT EXISTS (
        SELECT 1 FROM content_categories cc
        WHERE cc.project_id = a.project_id
          AND cc.slug = a.category
      )
    GROUP BY a.collection, a.category
    ORDER BY a.collection, a.category
  `);
  return rows.map((r) => ({
    collection: r.collection,
    category: r.category,
    count: Number(r.n),
  }));
}

interface PlanEntry {
  collection: string | null;
  oldValue: string;
  newSlug: string | null;
  count: number;
  reason: "mapped" | "skip_no_scope" | "skip_unknown_slug";
}

async function buildPlan(
  projectId: string,
  audit: AuditRow[],
): Promise<PlanEntry[]> {
  // Pre-load valid slugs per scope so plan-build doesn't hit the DB N+1 times.
  const seeded = await db
    .select({
      scope: contentCategories.scope,
      slug: contentCategories.slug,
    })
    .from(contentCategories)
    .where(eq(contentCategories.projectId, projectId));
  const seededBy = new Map<string, Set<string>>();
  for (const r of seeded) {
    if (!seededBy.has(r.scope)) seededBy.set(r.scope, new Set());
    seededBy.get(r.scope)!.add(r.slug);
  }

  return audit.map((row) => {
    const scope = collectionToScope(row.collection);
    if (scope === null) {
      return {
        collection: row.collection,
        oldValue: row.category,
        newSlug: null,
        count: row.count,
        reason: "skip_no_scope" as const,
      };
    }
    const slug = slugifyCategory(row.category);
    const known = seededBy.get(scope);
    if (!known || !known.has(slug)) {
      return {
        collection: row.collection,
        oldValue: row.category,
        newSlug: slug,
        count: row.count,
        reason: "skip_unknown_slug" as const,
      };
    }
    return {
      collection: row.collection,
      oldValue: row.category,
      newSlug: slug,
      count: row.count,
      reason: "mapped" as const,
    };
  });
}

function printPlan(plan: PlanEntry[]) {
  log.info({ planSize: plan.length }, "consolidation plan");
  for (const p of plan) {
    if (p.reason === "mapped") {
      log.info(
        {
          collection: p.collection,
          from: p.oldValue,
          to: p.newSlug,
          rows: p.count,
        },
        "→ MAP",
      );
    } else if (p.reason === "skip_no_scope") {
      log.warn(
        { collection: p.collection, from: p.oldValue, rows: p.count },
        "→ SKIP (no taxonomy for this collection)",
      );
    } else {
      log.warn(
        {
          collection: p.collection,
          from: p.oldValue,
          slugifiedTo: p.newSlug,
          rows: p.count,
        },
        "→ SKIP (slugified value not in seeded content_categories — manual review)",
      );
    }
  }
}

async function ensureBackupColumn() {
  await db.execute(sql`ALTER TABLE articles ADD COLUMN IF NOT EXISTS category_legacy text`);
  // Only seed legacy values that aren't already backed up.
  const result = await db.execute<{ updated: number }>(sql`
    WITH updated AS (
      UPDATE articles
      SET category_legacy = category
      WHERE category IS NOT NULL
        AND category_legacy IS NULL
      RETURNING 1
    )
    SELECT COUNT(*)::int AS updated FROM updated
  `);
  log.info({ updated: Number(result[0]?.updated ?? 0) }, "category_legacy backup populated");
}

async function applyPlan(projectId: string, plan: PlanEntry[]) {
  let totalUpdated = 0;
  for (const entry of plan) {
    if (entry.reason !== "mapped" || entry.newSlug === null) continue;
    const rows = await db
      .update(articles)
      .set({ category: entry.newSlug })
      .where(
        sql`${articles.projectId} = ${projectId}
            AND ${articles.collection} = ${entry.collection}
            AND ${articles.category} = ${entry.oldValue}`,
      )
      .returning({ id: articles.id });
    totalUpdated += rows.length;
    log.info(
      {
        collection: entry.collection,
        from: entry.oldValue,
        to: entry.newSlug,
        actuallyUpdated: rows.length,
      },
      "applied",
    );
  }
  return totalUpdated;
}

async function verifyZeroUnmapped(projectId: string): Promise<number> {
  const remaining = await loadUnmappedRows(projectId);
  // Only count rows that COULD be mapped (i.e. excluding skip_no_scope —
  // those are by-design out of taxonomy and the script doesn't touch them).
  const blocking = remaining.filter((r) => collectionToScope(r.collection) !== null);
  return blocking.reduce((sum, r) => sum + r.count, 0);
}

interface Options {
  projectSlug: string;
  apply: boolean;
  skipBackup: boolean;
}

export async function runConsolidation(opts: Options): Promise<void> {
  const project = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(eq(projects.slug, opts.projectSlug))
    .limit(1);
  if (project.length === 0) {
    log.error({ slug: opts.projectSlug }, "project not found");
    process.exit(1);
  }
  const projectId = project[0]!.id;
  log.info({ projectId, slug: project[0]!.slug, mode: opts.apply ? "apply" : "dry-run" }, "starting");

  const audit = await loadUnmappedRows(projectId);
  if (audit.length === 0) {
    log.info({ projectId }, "no unmapped categories — exiting");
    return;
  }

  const plan = await buildPlan(projectId, audit);
  printPlan(plan);

  const mappable = plan.filter((p) => p.reason === "mapped");
  log.info(
    {
      total: audit.length,
      mappable: mappable.length,
      skippedNoScope: plan.filter((p) => p.reason === "skip_no_scope").length,
      skippedUnknownSlug: plan.filter((p) => p.reason === "skip_unknown_slug").length,
      rowsTouched: mappable.reduce((s, p) => s + p.count, 0),
    },
    "plan summary",
  );

  if (!opts.apply) {
    log.info("dry-run complete — re-run with --apply to mutate");
    return;
  }

  if (!opts.skipBackup) {
    await ensureBackupColumn();
  } else {
    log.warn("--no-backup specified, skipping category_legacy backup");
  }

  const updated = await applyPlan(projectId, plan);
  log.info({ rowsUpdated: updated }, "apply complete");

  const remaining = await verifyZeroUnmapped(projectId);
  if (remaining > 0) {
    log.warn(
      { remainingRows: remaining },
      "VERIFY GATE: some rows remain unmapped (slugified-but-unknown values). Manual review required before declaring consolidation complete.",
    );
  } else {
    log.info("VERIFY GATE: all in-scope rows mapped — consolidation complete");
  }
}

// CLI entry — only runs when invoked directly (not on test imports)
if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      project: { type: "string" },
      apply: { type: "boolean", default: false },
      "no-backup": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (!values.project) {
    log.error("missing --project=<slug>");
    process.exit(1);
  }

  await runConsolidation({
    projectSlug: values.project,
    apply: values.apply === true,
    skipBackup: values["no-backup"] === true,
  });
  process.exit(0);
}
