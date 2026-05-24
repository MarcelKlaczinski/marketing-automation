/**
 * Spec 002 follow-up — reassign clusters from the `Uncategorized` pillar
 * fallback onto semantically correct pillars.
 *
 * Background: `SyncClustersFromFrontmatterStep` auto-creates pillars from
 * distinct `articles.category` values. Clusters whose articles have NO
 * `category` set (typical for `comparisons` + `usecases` collections) get
 * the `Uncategorized` fallback pillar. For Toolwiki, this means 20 of 46
 * clusters (44%) sit under the fallback even though they have a clear
 * semantic grouping by collection.
 *
 * This script reassigns them in two groups:
 *
 *   COMPARISONS — all comparisons-collection clusters
 *                (`*-comparisons-2026`, `ai-coding-tools-2026`,
 *                 `ai-presentation-tools-2026`) onto the `comparisons` pillar.
 *
 *   USECASES   — all usecases-collection clusters (`usecase-*`) onto a new
 *                `usecases` pillar (created if absent — Astro has no
 *                `usecase` category scope, so this pillar is our internal
 *                grouping convention for the flat `usecases` collection).
 *
 * Default mode is dry-run. Pass `--apply` to mutate.
 *
 * Usage:
 *   bun --filter @marketing-auto/api reassign-uncategorized-clusters --project=<slug> [flags]
 *
 * Flags:
 *   --project <slug>     REQUIRED. Cross-tenant guard.
 *   --apply              Actually mutate. Without this, counts only.
 *
 * Pattern 121 / D146: dry-run default, --apply opt-in, --project required,
 *                     DI ports for offline tests. Mirrors
 *                     cleanup-bucket-c-drift.ts shape (Spec 002).
 */

import { parseArgs } from "node:util";
import {
  and,
  clusters,
  contentPillars,
  db,
  eq,
  inArray,
  projects,
  sql,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("reassign-uncategorized-clusters");

// ─── Per-tenant reassignment definitions ─────────────────────────────────────

export interface ReassignmentGroup {
  /** Pillar name to assign clusters to. Created if missing. */
  targetPillarName: string;
  /** Description used when creating the pillar (if absent). */
  targetPillarDescription: string;
  /** Cluster names to reassign. */
  clusterNames: string[];
}

/**
 * Toolwiki — Spec 002 follow-up Marcel-decided mapping (2026-05-24).
 *
 * Two groups (20 clusters total under `Uncategorized` post-Re-Import):
 *
 *   COMPARISONS (8) — collection=comparisons articles. The `comparisons`
 *   pillar exists (blog-scope canonical from Astro categories), currently
 *   has 0 cluster references. Reassigning here groups all comparison-style
 *   clusters under the canonical pillar.
 *
 *   USECASES (12) — collection=usecases articles. Astro has no `usecase`
 *   category scope (`usecases` collection is intentionally flat). We create
 *   a `usecases` pillar as DB-internal grouping convention so the
 *   `Uncategorized` fallback becomes a true exception bucket.
 */
export const REASSIGNMENT_GROUPS_BY_PROJECT: Record<string, ReassignmentGroup[]> = {
  toolwiki: [
    {
      targetPillarName: "comparisons",
      targetPillarDescription: "Comparisons collection (Astro blog-scope canonical)",
      clusterNames: [
        "ai-coding-tools-2026",
        "ai-presentation-tools-2026",
        "chatbot-comparisons-2026",
        "code-comparisons-2026",
        "image-comparisons-2026",
        "music-comparisons-2026",
        "video-ki-comparisons-2026",
        "voice-comparisons-2026",
      ],
    },
    {
      targetPillarName: "usecases",
      targetPillarDescription: "Use-cases collection (vertical/industry topics, Astro flat collection without category scope)",
      clusterNames: [
        "usecase-customer-support",
        "usecase-ecommerce-retail",
        "usecase-education-research",
        "usecase-everyday-productivity",
        "usecase-finance-economy",
        "usecase-healthcare-medicine",
        "usecase-hr-recruiting",
        "usecase-marketing-sales",
        "usecase-production-industry",
        "usecase-public-legal",
        "usecase-security-cybersecurity",
        "usecase-software-it",
      ],
    },
  ],
};

// ─── Result types ────────────────────────────────────────────────────────────

export interface ReassignOptions {
  projectSlug: string;
  apply: boolean;
  database?: DatabasePort;
}

export interface GroupResult {
  targetPillarName: string;
  /** True when a NEW pillar was inserted (only on --apply with absent target). */
  pillarCreated: boolean;
  /** Number of clusters that would be / were reassigned. */
  candidates: number;
  affected: number;
}

export interface ReassignResult {
  projectSlug: string;
  projectId: string;
  dryRun: boolean;
  groups: GroupResult[];
}

// ─── Database port ───────────────────────────────────────────────────────────

export interface DatabasePort {
  resolveProjectIdBySlug(slug: string): Promise<string | null>;
  /** Returns pillar id by name, or null if absent. */
  resolvePillarIdByName(projectId: string, name: string): Promise<string | null>;
  /** Insert a new pillar. Returns the new id. */
  createPillar(projectId: string, name: string, description: string): Promise<string>;
  /** Count clusters in the given name list currently NOT pointing at the target pillar. */
  countReassignCandidates(
    projectId: string,
    clusterNames: string[],
    targetPillarId: string,
  ): Promise<number>;
  /** UPDATE clusters.pillarId + denormalized clusters.pillar text field atomically. */
  reassignClusters(
    projectId: string,
    clusterNames: string[],
    targetPillarId: string,
    targetPillarName: string,
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

    async createPillar(projectId, name, description) {
      // Position: append at end. SELECT MAX first to avoid concurrent-insert
      // duplicate positions (low-risk in this script, but cheap to do right).
      const [maxRow] = await db
        .select({ max: sql<number>`coalesce(max(${contentPillars.position}), -1)::int` })
        .from(contentPillars)
        .where(eq(contentPillars.projectId, projectId));
      const nextPosition = (maxRow?.max ?? -1) + 1;

      const [inserted] = await db
        .insert(contentPillars)
        .values({ projectId, name, description, position: nextPosition })
        .returning({ id: contentPillars.id });
      if (!inserted) {
        throw new Error(`Failed to create pillar '${name}' for project ${projectId}`);
      }
      return inserted.id;
    },

    async countReassignCandidates(projectId, clusterNames, targetPillarId) {
      if (clusterNames.length === 0) return 0;
      const [row] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(clusters)
        .where(
          and(
            eq(clusters.projectId, projectId),
            inArray(clusters.name, clusterNames),
            sql`${clusters.pillarId} != ${targetPillarId}`,
          ),
        );
      return row?.c ?? 0;
    },

    async reassignClusters(projectId, clusterNames, targetPillarId, targetPillarName) {
      if (clusterNames.length === 0) return [];
      return db
        .update(clusters)
        .set({ pillarId: targetPillarId, pillar: targetPillarName })
        .where(
          and(
            eq(clusters.projectId, projectId),
            inArray(clusters.name, clusterNames),
            sql`${clusters.pillarId} != ${targetPillarId}`,
          ),
        )
        .returning({ id: clusters.id, name: clusters.name });
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function reassignUncategorizedClusters(
  options: ReassignOptions,
): Promise<ReassignResult> {
  const database = options.database ?? defaultDatabasePort();

  const projectId = await database.resolveProjectIdBySlug(options.projectSlug);
  if (!projectId) {
    throw new Error(`Project not found: ${options.projectSlug}`);
  }

  const result: ReassignResult = {
    projectSlug: options.projectSlug,
    projectId,
    dryRun: !options.apply,
    groups: [],
  };

  const groupConfigs = REASSIGNMENT_GROUPS_BY_PROJECT[options.projectSlug] ?? [];

  if (groupConfigs.length === 0) {
    log.info(
      { projectSlug: options.projectSlug },
      `No reassignment groups configured for project '${options.projectSlug}' — skipping`,
    );
    return result;
  }

  for (const group of groupConfigs) {
    const groupResult: GroupResult = {
      targetPillarName: group.targetPillarName,
      pillarCreated: false,
      candidates: 0,
      affected: 0,
    };

    // Resolve target pillar id, creating if absent (only on --apply).
    let targetPillarId = await database.resolvePillarIdByName(projectId, group.targetPillarName);

    if (!targetPillarId) {
      if (options.apply) {
        targetPillarId = await database.createPillar(
          projectId,
          group.targetPillarName,
          group.targetPillarDescription,
        );
        groupResult.pillarCreated = true;
        log.info(
          { group: group.targetPillarName, pillarId: targetPillarId },
          `[${group.targetPillarName.toUpperCase()}] Created pillar`,
        );
      } else {
        log.info(
          { group: group.targetPillarName, clusters: group.clusterNames.length },
          `[${group.targetPillarName.toUpperCase()}] DRY-RUN — would CREATE pillar + reassign ${group.clusterNames.length} clusters`,
        );
        groupResult.candidates = group.clusterNames.length;
        result.groups.push(groupResult);
        continue;
      }
    }

    // Count + (optionally) apply reassignment.
    groupResult.candidates = await database.countReassignCandidates(
      projectId,
      group.clusterNames,
      targetPillarId,
    );

    log.info(
      {
        group: group.targetPillarName,
        candidates: groupResult.candidates,
        dryRun: !options.apply,
      },
      options.apply
        ? `[${group.targetPillarName.toUpperCase()}] Reassigning ${groupResult.candidates} clusters`
        : `[${group.targetPillarName.toUpperCase()}] DRY-RUN — would reassign ${groupResult.candidates} clusters`,
    );

    if (options.apply && groupResult.candidates > 0) {
      const updated = await database.reassignClusters(
        projectId,
        group.clusterNames,
        targetPillarId,
        group.targetPillarName,
      );
      groupResult.affected = updated.length;
      log.info(
        {
          group: group.targetPillarName,
          affected: groupResult.affected,
          clusters: updated.map((u) => u.name),
        },
        `[${group.targetPillarName.toUpperCase()}] Reassigned ${groupResult.affected} clusters`,
      );
    }

    result.groups.push(groupResult);
  }

  return result;
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

if (import.meta.main) {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      project: { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });

  if (!values.project) {
    log.error("Required: --project=<slug>");
    process.exit(1);
  }

  reassignUncategorizedClusters({
    projectSlug: values.project,
    apply: values.apply ?? false,
  })
    .then((result) => {
      log.info(result, "reassign-uncategorized-clusters: complete");
      if (result.dryRun) {
        log.info("Dry-run complete. Re-run with --apply once counts look right.");
      } else {
        log.info(
          "Reassignment applied. Run capture-bucket-c-baseline <slug> to verify.",
        );
      }
      process.exit(0);
    })
    .catch((err) => {
      log.error({ err }, "reassign-uncategorized-clusters: fatal");
      process.exit(1);
    });
}
