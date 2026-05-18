import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import {
  and,
  asc,
  db,
  eq,
  isNull,
  isNotNull,
  lt,
  articles,
  projects,
  refreshDismissed,
} from "@marketing-auto/db";
import { publishPipelineEvent } from "@marketing-auto/core/events";
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
  candidates: Array<{
    id: string;
    title: string | null;
    slug: string;
    locale: string;
    collection: string;
    clusterId: string | null;
    publishedAt: Date | null;
    updatedAt: Date;
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
        isNotNull(articles.lastRefreshedAt),
        lt(articles.lastRefreshedAt, cutoff),
        isNull(refreshDismissed.id)
      )
    )
    .orderBy(asc(articles.updatedAt));

  void publishPipelineEvent(projectId, {
    type: "refresh.detected",
    projectId,
    candidateCount: stale.length,
    autoApprovedCount: 0,
    timestamp: new Date().toISOString(),
  });

  return { projectId, candidateCount: stale.length, candidates: stale };
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startRefreshDetectorWorker() {
  return new Worker(
    REFRESH_DETECTOR_QUEUE,
    async (job: Job) => {
      const { projectId } = detectJobSchema.parse(job.data);
      log.info({ projectId }, "Running refresh detection");
      const result = await detectStaleArticles(projectId);
      log.info({ projectId, candidateCount: result.candidateCount }, "Refresh detection complete");
    },
    { connection: getConnection(), concurrency: 2 }
  );
}
