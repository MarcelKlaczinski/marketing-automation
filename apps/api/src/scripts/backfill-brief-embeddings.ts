/**
 * Spec 64.15 Phase C: backfill Voyage-3 embeddings into `topic_briefs.embedding`.
 *
 * After migration 0093 lands the column, existing briefs (created before Phase C
 * wired Voyage into emit-brief.ts) have `embedding = NULL`. The lazy-backfill
 * path in `createPlanRunEmbeddingProvider` (Spec 63.5 + 64.15 Phase C) handles
 * these at first plan-runner read, but a one-shot backfill is faster + lets
 * Marcel see the rough cost upfront instead of spreading it across plan-runs.
 *
 * Default mode is dry-run. Pass `--apply` to actually call Voyage.
 *
 * Usage:
 *   bun --filter @marketing-auto/api backfill-brief-embeddings [flags]
 *
 * Flags:
 *   --project <slug>     Resolve <slug> to a project and limit backfill to that
 *                        tenant. Without this flag every project's briefs are
 *                        processed (rare — only meaningful for multi-tenant
 *                        deploys; today Toolwiki is the only producer).
 *   --apply              Actually call Voyage and write embeddings. Without
 *                        this flag the script lists what it WOULD do.
 *   --batch-size <N>     Limit per-project batch size (default 50). The script
 *                        loops until no more briefs need backfill, but the
 *                        per-iteration count caps Voyage burst exposure.
 *
 * Cost: ~€0.0003 per Voyage embed call. Toolwiki has ~180 briefs at migration
 * time → ~€0.054 total. Backfill is one-time; new briefs land precomputed.
 *
 * Pattern mirrors `cleanup-orphan-heroes.ts` (Spec 64.10): DI ports for
 * offline tests, `--apply` opt-in, `import.meta.main` guard.
 */

import { parseArgs } from "node:util";
import { voyage } from "@marketing-auto/adapter-voyage";
import { COST_OPS } from "@marketing-auto/core/cost";
import {
  type TopicBrief,
  and,
  db,
  eq,
  isNull,
  projects,
  sql,
  topicBriefs,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("backfill-brief-embeddings");

export interface BackfillOptions {
  projectSlug?: string;
  apply: boolean;
  batchSize: number;
  embedder?: EmbedderPort;
  database?: DatabasePort;
}

export interface EmbedderPort {
  embed: (text: string, opts: { projectId: string; operation: string }) => Promise<number[]>;
}

export interface DatabasePort {
  resolveProjectIdBySlug: (slug: string) => Promise<string | null>;
  countBriefsWithoutEmbedding: (projectId: string | null) => Promise<number>;
  loadBriefsWithoutEmbedding: (projectId: string | null, limit: number) => Promise<TopicBrief[]>;
  updateBriefEmbedding: (briefId: string, embedding: number[]) => Promise<void>;
}

export interface BackfillResult {
  totalScanned: number;
  totalBackfilled: number;
  totalSkipped: number;
  totalFailed: number;
  dryRun: boolean;
}

const DEFAULT_BATCH_SIZE = 50;

// ─── Default port implementations (production wiring) ────────────────────────

function defaultEmbedderPort(): EmbedderPort {
  return {
    embed: (text, opts) =>
      voyage.embed(text, {
        projectId: opts.projectId,
        operation: opts.operation,
      }),
  };
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
    async countBriefsWithoutEmbedding(projectId) {
      const filter = projectId
        ? and(isNull(topicBriefs.embedding), eq(topicBriefs.projectId, projectId))
        : isNull(topicBriefs.embedding);
      const [row] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(topicBriefs)
        .where(filter);
      return row?.c ?? 0;
    },
    async loadBriefsWithoutEmbedding(projectId, limit) {
      const filter = projectId
        ? and(isNull(topicBriefs.embedding), eq(topicBriefs.projectId, projectId))
        : isNull(topicBriefs.embedding);
      return db.select().from(topicBriefs).where(filter).limit(limit);
    },
    async updateBriefEmbedding(briefId, embedding) {
      await db.update(topicBriefs).set({ embedding }).where(eq(topicBriefs.id, briefId));
    },
  };
}

// ─── Pure embedding text builder (mirrors emit-brief.ts) ─────────────────────

function buildEmbeddingTextFromBrief(brief: TopicBrief): string | null {
  const primary = (brief.primaryKeyword ?? "").trim();
  const title = (brief.topicTitle ?? "").trim();
  if (primary && title) return `${primary} ${title}`;
  if (primary) return primary;
  if (title) return title;
  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function backfillBriefEmbeddings(options: BackfillOptions): Promise<BackfillResult> {
  const embedder = options.embedder ?? defaultEmbedderPort();
  const database = options.database ?? defaultDatabasePort();
  const batchSize = options.batchSize > 0 ? options.batchSize : DEFAULT_BATCH_SIZE;

  let scopedProjectId: string | null = null;
  if (options.projectSlug) {
    scopedProjectId = await database.resolveProjectIdBySlug(options.projectSlug);
    if (!scopedProjectId) {
      throw new Error(`Project with slug '${options.projectSlug}' not found`);
    }
  }

  let totalScanned = 0;
  let totalBackfilled = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  // Dry-run path: do ONE count(*) read instead of paginating. Apply-mode's
  // SELECT predicate stays true forever in dry-run (no UPDATE flips
  // embedding from NULL to non-NULL between iterations), so a real paginated
  // dry-run would infinite-loop reading the same rows.
  if (!options.apply) {
    const total = await database.countBriefsWithoutEmbedding(scopedProjectId);
    log.info(
      { total, scoped: scopedProjectId, dryRun: true },
      "backfill-brief-embeddings: dry-run count"
    );
    return {
      totalScanned: total,
      totalBackfilled: total,
      totalSkipped: 0,
      totalFailed: 0,
      dryRun: true,
    };
  }

  // Apply path: loop until the candidate query returns 0 rows. Each iteration
  // UPDATEs up to `batchSize` briefs, shrinking the next iteration's SELECT
  // result by the same count. Keeps Voyage burst bounded.
  for (;;) {
    const briefs = await database.loadBriefsWithoutEmbedding(scopedProjectId, batchSize);
    if (briefs.length === 0) break;

    totalScanned += briefs.length;
    log.info(
      { batch: briefs.length, scoped: scopedProjectId },
      "backfill-brief-embeddings: processing batch"
    );

    for (const brief of briefs) {
      const text = buildEmbeddingTextFromBrief(brief);
      if (text === null) {
        log.warn(
          { briefId: brief.id },
          "skip: brief has no topicTitle or primaryKeyword — cannot embed"
        );
        totalSkipped++;
        continue;
      }

      try {
        const embedding = await embedder.embed(text, {
          projectId: brief.projectId,
          operation: COST_OPS.VOYAGE_EMBED_TEXT,
        });
        await database.updateBriefEmbedding(brief.id, embedding);
        totalBackfilled++;
      } catch (err) {
        log.warn(
          { err, briefId: brief.id, projectId: brief.projectId },
          "backfill-brief-embeddings: Voyage / DB write failed — continuing"
        );
        totalFailed++;
      }
    }

    // If this batch returned fewer than batchSize rows we've drained the queue.
    if (briefs.length < batchSize) break;
  }

  return {
    totalScanned,
    totalBackfilled,
    totalSkipped,
    totalFailed,
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
      "batch-size": { type: "string", default: String(DEFAULT_BATCH_SIZE) },
    },
  });

  const parsedBatchSize = Number.parseInt(values["batch-size"] ?? "", 10);
  const batchSize =
    Number.isFinite(parsedBatchSize) && parsedBatchSize > 0 ? parsedBatchSize : DEFAULT_BATCH_SIZE;

  const opts: BackfillOptions = {
    apply: values.apply ?? false,
    batchSize,
  };
  if (values.project) opts.projectSlug = values.project;

  backfillBriefEmbeddings(opts)
    .then((result) => {
      const summary = {
        ...result,
        projectSlug: values.project ?? "<all>",
        batchSize,
      };
      log.info(summary, "backfill-brief-embeddings: complete");
      if (!result.dryRun) {
        log.info(`Wrote ${result.totalBackfilled} embeddings.`);
      } else {
        log.info(
          `DRY-RUN: would backfill ${result.totalBackfilled} briefs. ` +
            `Pass --apply to actually call Voyage.`
        );
      }
      process.exit(0);
    })
    .catch((err) => {
      log.error({ err }, "backfill-brief-embeddings: fatal");
      process.exit(1);
    });
}
