/**
 * Spec 001: cleanup DB-side drift left over by Branch-A
 * (multi-domain-evolution) + Branch-B (Toolwiki-Astro schema-consolidation).
 *
 * Two phases:
 *
 *   ORPHANS — 10 hardcoded slugs in `collection='blog'` that no longer exist
 *             in the Astro repo (Comparison-Migrations, Slug-Renames, Pure
 *             Deletions). Flip to `status='superseded'` (NOT delete — keep an
 *             audit trail and stay reversible).
 *
 *   STALE   — `articles WHERE collection='comparisons'` rows still carrying
 *             legacy Blog-era `category` / `published_at` / `tags`. These are
 *             Refresh-Whitelist-protected (Spec multi-domain-evolution S1.1),
 *             so a Re-Import will NOT overwrite them. NULL them explicitly
 *             before the Re-Import so Re-Import writes the correct values.
 *
 * Default mode is dry-run. Pass `--apply` to actually mutate.
 *
 * Usage:
 *   bun --filter @marketing-auto/api cleanup-post-refactor-drift --project=<slug> [flags]
 *
 * Flags:
 *   --project <slug>     REQUIRED. Resolves to a project id; all mutations are
 *                        scoped via `project_id = <id>` (cross-tenant guard).
 *   --apply              Actually mutate. Without this, the script counts what
 *                        it WOULD do and exits.
 *   --only <phase>       "orphans" or "stale" — run only one phase. Default:
 *                        both phases run sequentially in one session.
 *
 * Pattern 121 / D146: dry-run default, --apply opt-in, --project required,
 *                     DI ports for offline tests. Mirrors
 *                     backfill-brief-embeddings.ts shape.
 */

import { parseArgs } from "node:util";
import {
  and,
  articles,
  db,
  eq,
  inArray,
  isNotNull,
  ne,
  or,
  projects,
  sql,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { ORPHAN_BLOG_SLUGS } from "./discovery/capture-cleanup-baseline.ts";

const log = createLogger("cleanup-post-refactor-drift");

const EXPECTED_ORPHAN_COUNT = 10;
const EXPECTED_STALE_MIN = 22; // Spec §1: 22 rows; §3 says 22-24 (tags row variance)
const EXPECTED_STALE_MAX = 24;

export type CleanupPhase = "orphans" | "stale";

export interface CleanupOptions {
  projectSlug: string;
  apply: boolean;
  only?: CleanupPhase;
  database?: DatabasePort;
}

export interface DatabasePort {
  resolveProjectIdBySlug: (slug: string) => Promise<string | null>;
  countOrphanCandidates: (projectId: string) => Promise<number>;
  supersedeOrphans: (projectId: string) => Promise<Array<{ id: string; slug: string; locale: string | null }>>;
  countStaleComparisons: (projectId: string) => Promise<number>;
  clearStaleComparisons: (projectId: string) => Promise<Array<{ id: string; slug: string; locale: string | null }>>;
}

export interface PhaseResult {
  candidates: number;
  affected: number;
  countMismatchWarning?: string;
}

export interface CleanupResult {
  projectSlug: string;
  projectId: string;
  dryRun: boolean;
  orphans?: PhaseResult;
  stale?: PhaseResult;
}

// ─── Default port (production wiring) ────────────────────────────────────────

function defaultDatabasePort(): DatabasePort {
  return {
    async resolveProjectIdBySlug(slug) {
      const rows = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.slug, slug))
        .limit(1);
      return rows[0]?.id ?? null;
    },

    async countOrphanCandidates(projectId) {
      const [row] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, projectId),
            eq(articles.collection, "blog"),
            inArray(articles.slug, [...ORPHAN_BLOG_SLUGS]),
            ne(articles.status, "superseded"),
          ),
        );
      return row?.c ?? 0;
    },

    async supersedeOrphans(projectId) {
      // `articles` has an `updatedAt` column with `withTimezone: true` —
      // Drizzle typed operators auto-serialize Date objects.
      return db
        .update(articles)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(
          and(
            eq(articles.projectId, projectId),
            eq(articles.collection, "blog"),
            inArray(articles.slug, [...ORPHAN_BLOG_SLUGS]),
            ne(articles.status, "superseded"),
          ),
        )
        .returning({
          id: articles.id,
          slug: articles.slug,
          locale: articles.locale,
        });
    },

    async countStaleComparisons(projectId) {
      // `tags` is text[] (NOT jsonb) — cardinality(arr) returns 0 for empty
      // arrays and treats NULL safely under the outer `IS NOT NULL` guard.
      const [row] = await db
        .select({ c: sql<number>`count(*)::int` })
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
      return row?.c ?? 0;
    },

    async clearStaleComparisons(projectId) {
      // Drizzle's `set({ tags: [] })` writes `'{}'::text[]` (empty Postgres
      // array). Spec §10 Q2 asked about `'[]'::jsonb` — actual schema is
      // text[], so empty array is the right answer (Spec §12 deviation).
      return db
        .update(articles)
        .set({
          category: null,
          publishedAt: null,
          tags: [],
          updatedAt: new Date(),
        })
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
        )
        .returning({
          id: articles.id,
          slug: articles.slug,
          locale: articles.locale,
        });
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function cleanupPostRefactorDrift(options: CleanupOptions): Promise<CleanupResult> {
  const database = options.database ?? defaultDatabasePort();

  const projectId = await database.resolveProjectIdBySlug(options.projectSlug);
  if (!projectId) {
    throw new Error(`Project not found: ${options.projectSlug}`);
  }

  const result: CleanupResult = {
    projectSlug: options.projectSlug,
    projectId,
    dryRun: !options.apply,
  };

  const doOrphans = !options.only || options.only === "orphans";
  const doStale = !options.only || options.only === "stale";

  // ── Phase 1: orphans ────────────────────────────────────────────────────
  if (doOrphans) {
    const candidates = await database.countOrphanCandidates(projectId);
    const phase: PhaseResult = { candidates, affected: 0 };

    if (candidates !== EXPECTED_ORPHAN_COUNT && candidates !== 0) {
      phase.countMismatchWarning =
        `Found ${candidates} orphan candidates (expected ${EXPECTED_ORPHAN_COUNT}). ` +
        `Either some are already superseded, or a slug has been added/removed in this project. ` +
        `Proceeding anyway — verify against the capture-cleanup-baseline snapshot.`;
      log.warn({ candidates, expected: EXPECTED_ORPHAN_COUNT }, phase.countMismatchWarning);
    }

    log.info(
      { phase: "orphans", candidates, dryRun: !options.apply },
      options.apply
        ? `[ORPHANS] Found ${candidates} candidates — applying`
        : `[ORPHANS] DRY-RUN — would supersede ${candidates} rows`,
    );

    if (options.apply && candidates > 0) {
      const updated = await database.supersedeOrphans(projectId);
      phase.affected = updated.length;
      log.info(
        { phase: "orphans", affected: phase.affected, rows: updated },
        `[ORPHANS] Updated ${phase.affected} rows`,
      );
    }

    result.orphans = phase;
  }

  // ── Phase 2: stale comparison fields ────────────────────────────────────
  if (doStale) {
    const candidates = await database.countStaleComparisons(projectId);
    const phase: PhaseResult = { candidates, affected: 0 };

    if (
      candidates !== 0 &&
      (candidates < EXPECTED_STALE_MIN || candidates > EXPECTED_STALE_MAX)
    ) {
      phase.countMismatchWarning =
        `Found ${candidates} stale comparison rows (expected ${EXPECTED_STALE_MIN}-${EXPECTED_STALE_MAX}). ` +
        `Proceeding anyway — verify against the capture-cleanup-baseline snapshot.`;
      log.warn(
        { candidates, expected: `${EXPECTED_STALE_MIN}-${EXPECTED_STALE_MAX}` },
        phase.countMismatchWarning,
      );
    }

    log.info(
      { phase: "stale", candidates, dryRun: !options.apply },
      options.apply
        ? `[STALE] Found ${candidates} stale comparison rows — applying`
        : `[STALE] DRY-RUN — would null category/published_at/tags on ${candidates} rows`,
    );

    if (options.apply && candidates > 0) {
      const updated = await database.clearStaleComparisons(projectId);
      phase.affected = updated.length;
      log.info(
        { phase: "stale", affected: phase.affected, rows: updated },
        `[STALE] Updated ${phase.affected} rows`,
      );
    }

    result.stale = phase;
  }

  return result;
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

function parseOnlyArg(raw: string | undefined): CleanupPhase | undefined {
  if (raw === undefined) return undefined;
  if (raw === "orphans" || raw === "stale") return raw;
  throw new Error(`--only must be "orphans" or "stale" (got "${raw}")`);
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      project: { type: "string" },
      apply: { type: "boolean", default: false },
      only: { type: "string" },
    },
  });

  if (!values.project) {
    log.error("Required: --project=<slug>");
    process.exit(1);
  }

  let only: CleanupPhase | undefined;
  try {
    only = parseOnlyArg(values.only);
  } catch (err) {
    log.error({ err }, "invalid --only flag");
    process.exit(1);
  }

  const opts: CleanupOptions = {
    projectSlug: values.project,
    apply: values.apply ?? false,
  };
  if (only !== undefined) opts.only = only;

  cleanupPostRefactorDrift(opts)
    .then((result) => {
      log.info(result, "cleanup-post-refactor-drift: complete");
      if (result.dryRun) {
        log.info(
          "Dry-run complete. Re-run with --apply once counts look right. " +
            "Capture a baseline snapshot first: capture-cleanup-baseline <slug>",
        );
      } else {
        log.info(
          "Cleanup applied. Run capture-cleanup-baseline <slug> to verify the post-state.",
        );
      }
      process.exit(0);
    })
    .catch((err) => {
      log.error({ err }, "cleanup-post-refactor-drift: fatal");
      process.exit(1);
    });
}
