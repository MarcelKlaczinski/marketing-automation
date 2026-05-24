/**
 * Spec 002 (Bucket-C-Cleanup): consolidate Schwesterkonzept-drift in
 * `content_pillars` + `clusters` tables.
 *
 * Two phases (run sequentially in one session, idempotent on re-run):
 *
 *   PILLARS — Bilingual / case-variant / display-form pillar duplicates get
 *             consolidated onto an EN-canonical, lowercase-slug-form keep-row.
 *             For each consolidation:
 *               1. Re-point any cluster whose `pillarId` references a drop-row
 *                  onto the keep-row's `id`, and update the denormalized
 *                  `clusters.pillar` text field at the same time.
 *               2. DELETE the drop-rows by name.
 *             FK from `clusters.pillarId` to `content_pillars.id` is
 *             `ON DELETE RESTRICT`, so the re-point MUST run first or DELETE
 *             will fail with a FK violation.
 *
 *   CLUSTERS — Bilingual cluster-key duplicates (e.g. `code-assistants-2026`
 *              keep, `code-assistenten-2026` drop) get consolidated onto an
 *              EN-canonical keep-row. For each consolidation:
 *               1. UPDATE `articles.cluster_key` from each drop-name to the
 *                  keep-name (preserves article ownership, kein technischer
 *                  Bruch da `cluster_key` ein String ist, kein FK).
 *               2. DELETE the drop-cluster rows by name.
 *
 * Per-tenant consolidations are encoded in
 * `PILLAR_CONSOLIDATIONS_BY_PROJECT` / `CLUSTER_CONSOLIDATIONS_BY_PROJECT`
 * top-level maps. A project without an entry is a no-op (defensive — cleanup
 * never touches a tenant whose drift hasn't been Marcel-reviewed).
 *
 * Convention going forward (also for future tenants):
 *   - Pillar names in DB are EN-canonical, lowercase-slug-form
 *     (`comparisons`, `ethics-law`, `practice` — NOT `Vergleiche` / `Praxis`)
 *   - Cluster names in DB are EN-canonical
 *     (`code-assistants-2026` — NOT `code-assistenten-2026`)
 *   - Astro-public-frontend handles per-locale display labels via its own
 *     `categories` collection (`translations.de.label`); our DB stays
 *     language-neutral, scalable across tenants, Branch-B-consistent.
 *
 * Default mode is dry-run. Pass `--apply` to mutate.
 *
 * Usage:
 *   bun --filter @marketing-auto/api cleanup-bucket-c-drift --project=<slug> [flags]
 *
 * Flags:
 *   --project <slug>     REQUIRED. Resolves to a project id; all mutations
 *                        are scoped via `project_id = <id>` (cross-tenant
 *                        guard).
 *   --apply              Actually mutate. Without this, the script counts
 *                        what it WOULD do and exits.
 *   --only <phase>       "pillars" or "clusters" — run only one phase.
 *                        Default: both run sequentially.
 *
 * Pattern 121 / D146: dry-run default, --apply opt-in, --project required,
 *                     DI ports for offline tests. Mirrors
 *                     cleanup-post-refactor-drift.ts shape (Spec 001).
 */

import { parseArgs } from "node:util";
import {
  and,
  articles,
  clusters,
  contentPillars,
  db,
  eq,
  inArray,
  projects,
  sql,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("cleanup-bucket-c-drift");

// ─── Consolidation definitions (per tenant) ──────────────────────────────────

export interface PillarConsolidation {
  /** EN-canonical, lowercase-slug-form name that stays. */
  keep: string;
  /** Names that get re-pointed + deleted. Drop-pillars MUST NOT have intent overrides. */
  drop: string[];
}

export interface ClusterConsolidation {
  /** EN-canonical cluster name that stays. */
  keep: string;
  /** Cluster names that get re-pointed (via articles.cluster_key) + deleted. */
  drop: string[];
}

/**
 * Toolwiki — Spec 002 BC1.2 Marcel-decided consolidations.
 *
 * Pillars: 7 bilingual EN/DE duplicates + 1 four-fold Praxis-drift (10 rows
 * total to drop). The 3 ki-wissen pillars with `intentTaxonomyOverride` set
 * (`ki-regulierte-branchen-2026`, `ki-sicherheit-datenschutz-2026`,
 * `rag-context-engineering-2026`) are NOT in the drop list — they are
 * Spec-conform custom configuration, not drift.
 *
 * Clusters: 1 bilingual pair (8 DE articles → EN slug).
 */
export const PILLAR_CONSOLIDATIONS_BY_PROJECT: Record<string, PillarConsolidation[]> = {
  toolwiki: [
    { keep: "comparisons", drop: ["Vergleiche"] },
    { keep: "ethics-law", drop: ["Ethik & Recht"] },
    { keep: "fundamentals", drop: ["Grundlagen"] },
    { keep: "future", drop: ["Zukunft"] },
    { keep: "guides-tutorials", drop: ["Guides & Tutorials"] },
    { keep: "technology", drop: ["Technik"] },
    { keep: "tool-reviews", drop: ["Tool-Reviews"] },
    { keep: "practice", drop: ["practice-use-cases", "Praxis", "Praxis & Use Cases"] },
  ],
  // Test-only fixture — smoke tests for the combined two-phase flow.
  // Real production tenants extend this map with their own entries.
  __test_fixture_cluster_phase__: [
    { keep: "keep-pillar", drop: ["drop-pillar-a"] },
  ],
};

/**
 * Cluster consolidations are INTENTIONALLY empty for Toolwiki.
 *
 * The original Spec 002 BC1.2 plan was to consolidate
 * `code-assistenten-2026` (DE) → `code-assistants-2026` (EN) on the DB side.
 * Discovery during BC2.2 surfaced two blockers:
 *
 *   1. `articles.cluster_key` is a mirror of the Astro MDX `clusterKey`
 *      frontmatter field — it is NOT in the refresh-whitelist. Any DB-side
 *      UPDATE survives only until the next Re-Import; the importer then
 *      writes the MDX value back, undoing our cleanup.
 *   2. The Astro public frontend ([BlogPost.astro](../../../../ki-wissensraum-neu/src/layouts/BlogPost.astro))
 *      reads `clusterKey` directly from MDX for the related-articles widget,
 *      tool-filtering, and +1000 same-cluster scoring. DB-side cleanup does
 *      not fix the actual public-site grouping — that lives in MDX.
 *
 * Marcel-decision 2026-05-24 — Option Y (per-locale-canonical):
 *   - Edit the 2 inconsistent MDX files in the Astro repo to align with
 *     the per-locale convention:
 *       tools/en/cursor.mdx          clusterKey → "code-assistants-2026"
 *       tools/en/github-copilot.mdx  clusterKey → "code-assistants-2026"
 *   - Keep BOTH clusters (`code-assistants-2026` for EN, `code-assistenten-2026`
 *     for DE) in DB as a deliberate per-locale split — DE and EN articles
 *     have separate semantic clusters by design.
 *   - After Re-Import (Marcel-action), the DB will naturally have a clean
 *     state: 4 EN articles under `code-assistants-2026`, 4 DE under
 *     `code-assistenten-2026`. (The 2 orphan blog articles
 *     `blog/de/code-assistenten` + `blog/en/ai-code-assistants` go to
 *     `status='superseded'` via Spec 001 cleanup, so they drop out of the
 *     active picture.)
 *
 * This map stays in place for forward-compat: future tenants might have
 * actual cluster-name duplicates that NEED the DB-side consolidation (e.g.
 * created by a buggy Cluster-Creator-LLM run that didn't write to MDX).
 * For Toolwiki specifically, the answer is "fix MDX upstream, let Re-Import
 * sync the DB".
 */
export const CLUSTER_CONSOLIDATIONS_BY_PROJECT: Record<string, ClusterConsolidation[]> = {
  toolwiki: [],
  // Test-only fixture — smoke tests need a project where cluster-phase
  // logic actually fires (Toolwiki's is intentionally empty after Option Y).
  // Real production tenants extend this map with their own entries.
  __test_fixture_cluster_phase__: [
    { keep: "keep-cluster", drop: ["drop-cluster-a", "drop-cluster-b"] },
  ],
};

// ─── Result types ────────────────────────────────────────────────────────────

export type CleanupPhase = "pillars" | "clusters";

export interface CleanupOptions {
  projectSlug: string;
  apply: boolean;
  only?: CleanupPhase;
  database?: DatabasePort;
}

export interface PillarPhaseResult {
  /** Number of distinct drop-pillar rows that would be / were removed. */
  dropCandidates: number;
  /** Number of clusters that would be / were re-pointed onto a keep-pillar. */
  clustersToRepoint: number;
  /** Actual mutations applied (0 in dry-run). */
  pillarsDeleted: number;
  clustersRepointed: number;
  /** Warning if a `keep` pillar referenced by a consolidation doesn't exist for this project. */
  missingKeepWarning?: string;
}

export interface ClusterPhaseResult {
  /** Number of distinct drop-cluster rows that would be / were removed. */
  dropCandidates: number;
  /** Number of articles whose `cluster_key` would be / was re-referenced. */
  articlesToReReference: number;
  /** Actual mutations applied (0 in dry-run). */
  clustersDeleted: number;
  articlesReReferenced: number;
}

export interface CleanupResult {
  projectSlug: string;
  projectId: string;
  dryRun: boolean;
  pillars?: PillarPhaseResult;
  clusters?: ClusterPhaseResult;
}

// ─── Database port ───────────────────────────────────────────────────────────

export interface DatabasePort {
  resolveProjectIdBySlug(slug: string): Promise<string | null>;

  /** Count drop-pillar rows that actually exist for this project. */
  countPillarDropRows(projectId: string, dropNames: string[]): Promise<number>;
  /** Resolve a single pillar by name → its id, or null if absent. */
  resolvePillarIdByName(projectId: string, name: string): Promise<string | null>;
  /** Count clusters whose `pillarId` points at any drop-pillar (re-point candidates). */
  countClustersOnPillarIds(projectId: string, pillarIds: string[]): Promise<number>;
  /** Re-point all clusters from drop-pillar-ids to keep-pillar-id, also updating denormalized `pillar` text. */
  repointClustersToPillar(
    projectId: string,
    keepPillarId: string,
    keepPillarName: string,
    dropPillarIds: string[],
  ): Promise<number>;
  /** DELETE pillars by name. Returns deleted-row identifiers for audit. */
  deletePillarsByName(
    projectId: string,
    names: string[],
  ): Promise<Array<{ id: string; name: string }>>;

  /** Count drop-cluster rows that actually exist for this project. */
  countClusterDropRows(projectId: string, dropNames: string[]): Promise<number>;
  /** Count articles whose `cluster_key` matches any drop-name (re-reference candidates). */
  countArticlesOnClusterKeys(projectId: string, dropNames: string[]): Promise<number>;
  /** Re-reference articles from any drop-name → keep-name. */
  reReferenceArticles(
    projectId: string,
    keepName: string,
    dropNames: string[],
  ): Promise<Array<{ id: string; slug: string; locale: string | null }>>;
  /** DELETE clusters by name. */
  deleteClustersByName(
    projectId: string,
    names: string[],
  ): Promise<Array<{ id: string; name: string }>>;
}

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

    async countPillarDropRows(projectId, dropNames) {
      if (dropNames.length === 0) return 0;
      const [row] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(contentPillars)
        .where(
          and(
            eq(contentPillars.projectId, projectId),
            inArray(contentPillars.name, dropNames),
          ),
        );
      return row?.c ?? 0;
    },

    async resolvePillarIdByName(projectId, name) {
      const rows = await db
        .select({ id: contentPillars.id })
        .from(contentPillars)
        .where(
          and(
            eq(contentPillars.projectId, projectId),
            eq(contentPillars.name, name),
          ),
        )
        .limit(1);
      return rows[0]?.id ?? null;
    },

    async countClustersOnPillarIds(projectId, pillarIds) {
      if (pillarIds.length === 0) return 0;
      const [row] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(clusters)
        .where(
          and(
            eq(clusters.projectId, projectId),
            inArray(clusters.pillarId, pillarIds),
          ),
        );
      return row?.c ?? 0;
    },

    async repointClustersToPillar(projectId, keepPillarId, keepPillarName, dropPillarIds) {
      if (dropPillarIds.length === 0) return 0;
      const rows = await db
        .update(clusters)
        .set({ pillarId: keepPillarId, pillar: keepPillarName })
        .where(
          and(
            eq(clusters.projectId, projectId),
            inArray(clusters.pillarId, dropPillarIds),
          ),
        )
        .returning({ id: clusters.id });
      return rows.length;
    },

    async deletePillarsByName(projectId, names) {
      if (names.length === 0) return [];
      return db
        .delete(contentPillars)
        .where(
          and(
            eq(contentPillars.projectId, projectId),
            inArray(contentPillars.name, names),
          ),
        )
        .returning({ id: contentPillars.id, name: contentPillars.name });
    },

    async countClusterDropRows(projectId, dropNames) {
      if (dropNames.length === 0) return 0;
      const [row] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(clusters)
        .where(
          and(
            eq(clusters.projectId, projectId),
            inArray(clusters.name, dropNames),
          ),
        );
      return row?.c ?? 0;
    },

    async countArticlesOnClusterKeys(projectId, dropNames) {
      if (dropNames.length === 0) return 0;
      const [row] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, projectId),
            inArray(articles.clusterKey, dropNames),
          ),
        );
      return row?.c ?? 0;
    },

    async reReferenceArticles(projectId, keepName, dropNames) {
      if (dropNames.length === 0) return [];
      return db
        .update(articles)
        .set({ clusterKey: keepName, updatedAt: new Date() })
        .where(
          and(
            eq(articles.projectId, projectId),
            inArray(articles.clusterKey, dropNames),
          ),
        )
        .returning({
          id: articles.id,
          slug: articles.slug,
          locale: articles.locale,
        });
    },

    async deleteClustersByName(projectId, names) {
      if (names.length === 0) return [];
      return db
        .delete(clusters)
        .where(
          and(
            eq(clusters.projectId, projectId),
            inArray(clusters.name, names),
          ),
        )
        .returning({ id: clusters.id, name: clusters.name });
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function cleanupBucketCDrift(options: CleanupOptions): Promise<CleanupResult> {
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

  const doPillars = !options.only || options.only === "pillars";
  const doClusters = !options.only || options.only === "clusters";

  const pillarConsolidations = PILLAR_CONSOLIDATIONS_BY_PROJECT[options.projectSlug] ?? [];
  const clusterConsolidations = CLUSTER_CONSOLIDATIONS_BY_PROJECT[options.projectSlug] ?? [];

  // ── Phase 1: pillars ────────────────────────────────────────────────────
  if (doPillars) {
    const phase: PillarPhaseResult = {
      dropCandidates: 0,
      clustersToRepoint: 0,
      pillarsDeleted: 0,
      clustersRepointed: 0,
    };

    if (pillarConsolidations.length === 0) {
      log.info(
        { phase: "pillars", projectSlug: options.projectSlug },
        `[PILLARS] No consolidations configured for project '${options.projectSlug}' — skipping`,
      );
    } else {
      // Pre-flight: count + verify each keep-pillar exists.
      const missingKeeps: string[] = [];
      for (const consolidation of pillarConsolidations) {
        const dropCount = await database.countPillarDropRows(projectId, consolidation.drop);
        phase.dropCandidates += dropCount;

        const keepId = await database.resolvePillarIdByName(projectId, consolidation.keep);
        if (!keepId) {
          // Only an issue if we'd actually re-point — log the warning and skip the consolidation
          // (drop-pillars with 0 cluster refs could still be deleted, but conservative).
          missingKeeps.push(consolidation.keep);
          continue;
        }

        // Count cluster re-point candidates for this consolidation.
        // Resolve drop-pillar IDs through the DI port (NOT inline db.select)
        // so the fake DatabasePort in tests intercepts these calls correctly.
        const dropIds = await Promise.all(
          consolidation.drop.map((name) => database.resolvePillarIdByName(projectId, name)),
        );
        const realDropIds = dropIds.filter((id): id is string => id !== null);
        const repointCount = await database.countClustersOnPillarIds(projectId, realDropIds);
        phase.clustersToRepoint += repointCount;
      }

      if (missingKeeps.length > 0) {
        phase.missingKeepWarning =
          `Keep-pillars not present for project '${options.projectSlug}': ` +
          missingKeeps.join(", ") +
          `. These consolidations are skipped (drop-rows are NOT deleted ` +
          `because their attached clusters would lose their pillar reference). ` +
          `Either create the keep-pillars manually or remove these entries from ` +
          `the consolidation list.`;
        log.warn({ missingKeeps }, phase.missingKeepWarning);
      }

      log.info(
        {
          phase: "pillars",
          consolidations: pillarConsolidations.length,
          dropCandidates: phase.dropCandidates,
          clustersToRepoint: phase.clustersToRepoint,
          dryRun: !options.apply,
        },
        options.apply
          ? `[PILLARS] Applying ${pillarConsolidations.length} consolidations — ` +
            `${phase.dropCandidates} pillars to drop, ${phase.clustersToRepoint} clusters to re-point`
          : `[PILLARS] DRY-RUN — would drop ${phase.dropCandidates} pillars + re-point ${phase.clustersToRepoint} clusters`,
      );

      if (options.apply) {
        for (const consolidation of pillarConsolidations) {
          if (missingKeeps.includes(consolidation.keep)) continue;

          const keepId = await database.resolvePillarIdByName(projectId, consolidation.keep);
          if (!keepId) continue; // double-check (race-safety, should not happen)

          // Resolve drop-pillar IDs for re-point.
          const dropIds: string[] = [];
          for (const name of consolidation.drop) {
            const id = await database.resolvePillarIdByName(projectId, name);
            if (id) dropIds.push(id);
          }

          // Re-point clusters onto keep-pillar (text field included).
          if (dropIds.length > 0) {
            const repointed = await database.repointClustersToPillar(
              projectId,
              keepId,
              consolidation.keep,
              dropIds,
            );
            phase.clustersRepointed += repointed;
            if (repointed > 0) {
              log.info(
                { phase: "pillars", keep: consolidation.keep, repointed },
                `[PILLARS] Re-pointed ${repointed} clusters → '${consolidation.keep}'`,
              );
            }
          }

          // DELETE drop-pillars by name.
          const deleted = await database.deletePillarsByName(projectId, consolidation.drop);
          phase.pillarsDeleted += deleted.length;
          if (deleted.length > 0) {
            log.info(
              { phase: "pillars", keep: consolidation.keep, deleted: deleted.map((d) => d.name) },
              `[PILLARS] Deleted ${deleted.length} drop-pillars → consolidated onto '${consolidation.keep}'`,
            );
          }
        }
      }
    }

    result.pillars = phase;
  }

  // ── Phase 2: clusters ──────────────────────────────────────────────────
  if (doClusters) {
    const phase: ClusterPhaseResult = {
      dropCandidates: 0,
      articlesToReReference: 0,
      clustersDeleted: 0,
      articlesReReferenced: 0,
    };

    if (clusterConsolidations.length === 0) {
      log.info(
        { phase: "clusters", projectSlug: options.projectSlug },
        `[CLUSTERS] No consolidations configured for project '${options.projectSlug}' — skipping`,
      );
    } else {
      // Pre-flight count.
      for (const consolidation of clusterConsolidations) {
        const dropCount = await database.countClusterDropRows(projectId, consolidation.drop);
        phase.dropCandidates += dropCount;
        const articleCount = await database.countArticlesOnClusterKeys(
          projectId,
          consolidation.drop,
        );
        phase.articlesToReReference += articleCount;
      }

      log.info(
        {
          phase: "clusters",
          consolidations: clusterConsolidations.length,
          dropCandidates: phase.dropCandidates,
          articlesToReReference: phase.articlesToReReference,
          dryRun: !options.apply,
        },
        options.apply
          ? `[CLUSTERS] Applying ${clusterConsolidations.length} consolidations — ` +
            `${phase.dropCandidates} clusters to drop, ${phase.articlesToReReference} articles to re-reference`
          : `[CLUSTERS] DRY-RUN — would drop ${phase.dropCandidates} clusters + re-reference ${phase.articlesToReReference} articles`,
      );

      if (options.apply) {
        for (const consolidation of clusterConsolidations) {
          // Articles re-reference VOR Cluster-Delete (Spec §6 Cross-Cutting-Rule —
          // sonst orphaned cluster_keys, no FK so kein DB-Bruch, aber Audit-Trail
          // verloren).
          const updated = await database.reReferenceArticles(
            projectId,
            consolidation.keep,
            consolidation.drop,
          );
          phase.articlesReReferenced += updated.length;
          if (updated.length > 0) {
            log.info(
              { phase: "clusters", keep: consolidation.keep, count: updated.length },
              `[CLUSTERS] Re-referenced ${updated.length} articles → '${consolidation.keep}'`,
            );
          }

          // Cluster rows DELETE.
          const deleted = await database.deleteClustersByName(projectId, consolidation.drop);
          phase.clustersDeleted += deleted.length;
          if (deleted.length > 0) {
            log.info(
              { phase: "clusters", keep: consolidation.keep, deleted: deleted.map((d) => d.name) },
              `[CLUSTERS] Deleted ${deleted.length} drop-clusters → consolidated onto '${consolidation.keep}'`,
            );
          }
        }
      }
    }

    result.clusters = phase;
  }

  return result;
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

function parseOnlyArg(raw: string | undefined): CleanupPhase | undefined {
  if (raw === undefined) return undefined;
  if (raw === "pillars" || raw === "clusters") return raw;
  throw new Error(`--only must be "pillars" or "clusters" (got "${raw}")`);
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

  cleanupBucketCDrift(opts)
    .then((result) => {
      log.info(result, "cleanup-bucket-c-drift: complete");
      if (result.dryRun) {
        log.info(
          "Dry-run complete. Re-run with --apply once counts look right. " +
            "Capture a baseline snapshot first: capture-bucket-c-baseline <slug>",
        );
      } else {
        log.info(
          "Cleanup applied. Run capture-bucket-c-baseline <slug> to verify the post-state.",
        );
      }
      process.exit(0);
    })
    .catch((err) => {
      log.error({ err }, "cleanup-bucket-c-drift: fatal");
      process.exit(1);
    });
}
