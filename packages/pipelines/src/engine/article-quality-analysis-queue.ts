// Spec E.1a: BullMQ queue for async article quality analysis.
// Lives in packages/pipelines so the cron handler can enqueue directly.
// The worker (apps/api/src/workers/article-quality-analysis.worker.ts) also imports from here.
import { Queue } from "bullmq";
import { createLogger, getEnv } from "@marketing-auto/shared";
import IORedis from "ioredis";

const log = createLogger("pipelines:article-quality-analysis-queue");

// ─── Types ────────────────────────────────────────────────────────────────────

export type ArticleQualityAnalysisJobData =
  | { articleId: string; projectId: string; projectSlug: string }
  | { type: "cron-triggered"; projectId: string };

export type ArticleQualityAnalysisJobResult = {
  articleId: string;
  recommendation: "refresh-now" | "refresh-soon" | "no-action";
  suggestionId: string | null;
};

// ─── Redis + Queue singleton ──────────────────────────────────────────────────

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _connection;
}

const QUEUE_NAME = "article-quality-analysis";

let _queue: Queue<ArticleQualityAnalysisJobData, ArticleQualityAnalysisJobResult> | null = null;
export function getArticleQualityAnalysisQueue(): Queue<ArticleQualityAnalysisJobData, ArticleQualityAnalysisJobResult> {
  if (_queue) return _queue;
  _queue = new Queue<ArticleQualityAnalysisJobData, ArticleQualityAnalysisJobResult>(QUEUE_NAME, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 10000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
    },
  });
  return _queue;
}

// ─── Enqueue helper ───────────────────────────────────────────────────────────

export type ArticleQualityAnalysisPerArticleData = { articleId: string; projectId: string; projectSlug: string };

/**
 * Enqueue a quality analysis job for a single article.
 * Uses articleId as jobId for idempotency — enqueueing twice for the same article is a no-op.
 */
export async function enqueueArticleQualityAnalysis(data: ArticleQualityAnalysisPerArticleData): Promise<string> {
  const queue = getArticleQualityAnalysisQueue();

  const job = await queue.add("analyze", data, {
    jobId: `quality-${data.articleId}`,
  });

  const jobId = job.id!;
  log.info({ articleId: data.articleId, jobId }, "Article quality analysis job enqueued");
  return jobId;
}

export async function closeArticleQualityAnalysisQueue(): Promise<void> {
  if (_queue) await _queue.close();
  if (_connection) await _connection.quit();
}
