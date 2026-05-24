/**
 * Spec 64.18 / Phase A (M7): hard-delete `rejected_topic_candidates` rows
 * older than 30 days.
 *
 * `rejected_topic_candidates` accumulates rows during trend synthesis (Spec
 * 54.5) with a 30-day `expires_at` window — past that, the row carries no
 * value (the same topic resurfaces fresh if signals rebuild momentum). There
 * is no automatic cleanup today; this script is the manual prune.
 *
 * Default mode is dry-run (count only). Pass `--apply` to actually delete.
 *
 * Usage:
 *   bun --filter @marketing-auto/api prune-rejected-topic-candidates --project=<slug> [--apply]
 *
 * Flags:
 *   --project <slug>     REQUIRED in apply-mode (D29: cross-tenant guard).
 *                        Optional in dry-run mode (omit to count across all
 *                        tenants).
 *   --apply              Actually delete. Without this, the script counts
 *                        what it WOULD do and exits.
 *
 * Pattern (D29): dry-run = count(*) short-circuit; apply = scoped DELETE
 * requiring `--project=<slug>` to prevent accidental cross-tenant mass-deletes.
 * Mirrors backfill-brief-embeddings.ts shape (Spec 64.15).
 *
 * Spec deviation: §3.1 referenced `rejectedTopicCandidates.createdAt` — actual
 * column is `rejectedAt` (verified in packages/db/src/schema/content.ts:1140).
 */

import { parseArgs } from "node:util";
import {
  and,
  db,
  eq,
  lt,
  projects,
  rejectedTopicCandidates,
  sql,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("prune-rejected-topic-candidates");

const PRUNE_AGE_DAYS = 30;

export interface PruneOptions {
  projectSlug?: string;
  apply: boolean;
  database?: DatabasePort;
}

export interface DatabasePort {
  resolveProjectIdBySlug: (slug: string) => Promise<string | null>;
  countCandidates: (projectId: string | null, cutoff: Date) => Promise<number>;
  deleteCandidates: (projectId: string, cutoff: Date) => Promise<number>;
}

export interface PruneResult {
  cutoff: Date;
  projectScope: string;
  candidates: number;
  deleted: number;
  dryRun: boolean;
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
    async countCandidates(projectId, cutoff) {
      const filter = projectId
        ? and(
            lt(rejectedTopicCandidates.rejectedAt, cutoff),
            eq(rejectedTopicCandidates.projectId, projectId),
          )
        : lt(rejectedTopicCandidates.rejectedAt, cutoff);
      const [row] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(rejectedTopicCandidates)
        .where(filter);
      return row?.c ?? 0;
    },
    async deleteCandidates(projectId, cutoff) {
      const rows = await db
        .delete(rejectedTopicCandidates)
        .where(
          and(
            lt(rejectedTopicCandidates.rejectedAt, cutoff),
            eq(rejectedTopicCandidates.projectId, projectId),
          ),
        )
        .returning({ id: rejectedTopicCandidates.id });
      return rows.length;
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function pruneRejectedTopicCandidates(
  options: PruneOptions,
): Promise<PruneResult> {
  const database = options.database ?? defaultDatabasePort();
  const cutoff = new Date(Date.now() - PRUNE_AGE_DAYS * 24 * 60 * 60 * 1000);

  let scopedProjectId: string | null = null;
  if (options.projectSlug) {
    scopedProjectId = await database.resolveProjectIdBySlug(options.projectSlug);
    if (!scopedProjectId) {
      throw new Error(`Project with slug '${options.projectSlug}' not found`);
    }
  }

  const projectScope = options.projectSlug ?? "<all>";

  // Dry-run: single count(*). No paginated walk — predicate stays true forever
  // without DELETEs flipping rows out, so a real loop would infinite-loop on
  // the same row-set (the 64.15 backfill-script footgun).
  if (!options.apply) {
    const total = await database.countCandidates(scopedProjectId, cutoff);
    log.info(
      { total, scope: projectScope, cutoff: cutoff.toISOString(), dryRun: true },
      "prune-rejected-topic-candidates: dry-run",
    );
    return {
      cutoff,
      projectScope,
      candidates: total,
      deleted: 0,
      dryRun: true,
    };
  }

  // D29: apply-mode requires --project to prevent cross-tenant mass-delete.
  if (!scopedProjectId) {
    log.error(
      "prune-rejected-topic-candidates: --apply requires --project=<slug> (D29 safety)",
    );
    throw new Error("--apply requires --project=<slug>");
  }

  const candidates = await database.countCandidates(scopedProjectId, cutoff);
  const deleted = await database.deleteCandidates(scopedProjectId, cutoff);

  log.info(
    {
      deleted,
      candidates,
      scope: projectScope,
      cutoff: cutoff.toISOString(),
      dryRun: false,
    },
    "prune-rejected-topic-candidates: applied",
  );

  return {
    cutoff,
    projectScope,
    candidates,
    deleted,
    dryRun: false,
  };
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

  const opts: PruneOptions = { apply: values.apply ?? false };
  if (values.project) opts.projectSlug = values.project;

  pruneRejectedTopicCandidates(opts)
    .then((result) => {
      if (result.dryRun) {
        log.info(
          `DRY-RUN: would delete ${result.candidates} rejected_topic_candidates ` +
            `older than ${result.cutoff.toISOString()} (scope: ${result.projectScope}). ` +
            `Pass --apply --project=<slug> to actually delete.`,
        );
      } else {
        log.info(
          `APPLIED: deleted ${result.deleted} rejected_topic_candidates ` +
            `for project ${result.projectScope} (cutoff: ${result.cutoff.toISOString()})`,
        );
      }
      process.exit(0);
    })
    .catch((err) => {
      log.error({ err }, "prune-rejected-topic-candidates: fatal");
      process.exit(1);
    });
}
