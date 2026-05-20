import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import {
  and,
  asc,
  db,
  eq,
  inArray,
  isNull,
  articles,
  projects,
  refreshDismissed,
  refreshSuggestions,
  sql,
} from "@marketing-auto/db";
import { publishPipelineEvent } from "@marketing-auto/core/events";
import { effectiveFreshnessSql } from "@marketing-auto/cost-tracker";
import { createLogger, getEnv } from "@marketing-auto/shared";

const log = createLogger("refresh-detector");

export const REFRESH_DETECTOR_QUEUE = "refresh-detector";

// ─── Redis connection ─────────────────────────────────────────────────────────

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

let _queue: Queue | null = null;
export function getRefreshDetectorQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(REFRESH_DETECTOR_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 60_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });
  return _queue;
}

// ─── Job schema ───────────────────────────────────────────────────────────────

const detectJobSchema = z.object({
  projectId: z.string().uuid(),
});

export type RefreshDetectionResult = {
  projectId: string;
  candidateCount: number;
  persistedCount: number;
  candidates: Array<{
    id: string;
    title: string | null;
    slug: string;
    locale: string;
    collection: string;
    clusterId: string | null;
    publishedAt: Date | null;
    updatedAt: Date;
    stalenessDays: number;
  }>;
};

// ─── Detection logic ──────────────────────────────────────────────────────────

export async function detectStaleArticles(projectId: string): Promise<RefreshDetectionResult> {
  const [project] = await db
    .select({ refreshStalenessThresholdDays: projects.refreshStalenessThresholdDays })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) throw new Error(`Project not found: ${projectId}`);

  const thresholdDays = project.refreshStalenessThresholdDays;
  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  // Effective-freshness expression — the canonical definition lives in
  // @marketing-auto/cost-tracker so refresh-detector, /refresh-candidates,
  // /discovery-counts and the weekly-budget planner all agree.
  const stale = await db
    .select({
      id: articles.id,
      title: articles.title,
      slug: articles.slug,
      locale: articles.locale,
      collection: articles.collection,
      clusterId: articles.clusterId,
      publishedAt: articles.publishedAt,
      updatedAt: articles.updatedAt,
      effectiveDate: sql<string>`${effectiveFreshnessSql}`.as("effective_date"),
    })
    .from(articles)
    .leftJoin(
      refreshDismissed,
      and(
        eq(refreshDismissed.projectId, projectId),
        eq(refreshDismissed.articleId, articles.id)
      )
    )
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.status, "published"),
        sql`${effectiveFreshnessSql} < ${cutoffIso}`,
        isNull(refreshDismissed.id)
      )
    )
    .orderBy(asc(articles.updatedAt));

  const now = Date.now();
  const candidates = stale.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    locale: row.locale,
    collection: row.collection,
    clusterId: row.clusterId,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
    stalenessDays: Math.max(
      0,
      Math.floor((now - new Date(row.effectiveDate).getTime()) / (24 * 60 * 60 * 1000)),
    ),
  }));

  // Auto-dismiss obsolete time-based suggestions: rows that exist as active but the article
  // is no longer in the stale set (e.g. the author bumped Astro `updated:` since the last run).
  // Without this, UI keeps showing stale entries after a refresh.
  const staleIds = new Set(candidates.map((c) => c.id));
  const activeTimeBased = await db
    .select({ id: refreshSuggestions.id, articleId: refreshSuggestions.articleId })
    .from(refreshSuggestions)
    .where(
      and(
        eq(refreshSuggestions.projectId, projectId),
        eq(refreshSuggestions.source, "time"),
        isNull(refreshSuggestions.dismissedAt),
        isNull(refreshSuggestions.approvedAt),
      ),
    );
  const obsoleteIds = activeTimeBased.filter((r) => !staleIds.has(r.articleId)).map((r) => r.id);
  let dismissedCount = 0;
  if (obsoleteIds.length > 0) {
    const dismissed = await db
      .update(refreshSuggestions)
      .set({ dismissedAt: new Date() })
      .where(inArray(refreshSuggestions.id, obsoleteIds))
      .returning({ id: refreshSuggestions.id });
    dismissedCount = dismissed.length;
  }

  // Persist new suggestions (source='time'). Unique (article_id, source) — re-runs are no-ops.
  let persistedCount = 0;
  if (candidates.length > 0) {
    const inserted = await db
      .insert(refreshSuggestions)
      .values(
        candidates.map((c) => ({
          projectId,
          articleId: c.id,
          source: "time" as const,
          stalenessDays: c.stalenessDays,
          reasoning: `Time-based: ${c.stalenessDays}d since last refresh (threshold ${thresholdDays}d).`,
        })),
      )
      .onConflictDoNothing({ target: [refreshSuggestions.articleId, refreshSuggestions.source] })
      .returning({ id: refreshSuggestions.id });
    persistedCount = inserted.length;
  }

  if (dismissedCount > 0 || persistedCount > 0) {
    log.info(
      { projectId, persistedCount, dismissedCount },
      "Refresh detection persisted+pruned suggestions",
    );
  }

  void publishPipelineEvent(projectId, {
    type: "refresh.detected",
    projectId,
    candidateCount: candidates.length,
    autoApprovedCount: 0,
    timestamp: new Date().toISOString(),
  });

  return { projectId, candidateCount: candidates.length, persistedCount, candidates };
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startRefreshDetectorWorker() {
  return new Worker(
    REFRESH_DETECTOR_QUEUE,
    async (job: Job) => {
      const { projectId } = detectJobSchema.parse(job.data);
      log.info({ projectId }, "Running refresh detection");
      const result = await detectStaleArticles(projectId);
      log.info(
        { projectId, candidateCount: result.candidateCount, persistedCount: result.persistedCount },
        "Refresh detection complete",
      );
    },
    { connection: getConnection(), concurrency: 2 }
  );
}
