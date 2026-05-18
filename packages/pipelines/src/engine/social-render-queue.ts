// Spec 57.2: BullMQ queue for async Remotion rendering.
// Intentionally lives in packages/pipelines so pipeline steps can enqueue directly.
// The worker (apps/api/src/workers/social-render.worker.ts) also imports from here.
import { Queue } from "bullmq";
import { db, eq, socialPosts } from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";
import IORedis from "ioredis";

const log = createLogger("pipelines:social-render-queue");

// ─── Types ────────────────────────────────────────────────────────────────────

export type SocialRenderJobData = {
  socialPostId: string;
  projectId: string;
  articleId: string;
  templateKey: string;
  locale: string;
  brandTokens: Record<string, unknown>;
  overrides: Record<string, unknown>;
  resolvedTools: Array<Record<string, unknown>>;
  articleTitle: string;
  articleSlug: string;
  projectSlug: string;
  articleUrl: string;
  theme: string;
  variant: string;
  coverEyebrow: string;
  coverHeadlineLead: string;
  coverHeadlineHighlight: string;
  coverHeadlineTrail?: string;
  coverSubhead?: string;
  endHeadline: string;
  endHeadlineHighlight: string;
  coverHookOutput?: Record<string, unknown>;
  endCloser?: Record<string, unknown>;
};

export type SocialRenderJobResult = {
  socialPostId: string;
  slideUrls: string[];
  totalSlides: number;
};

// ─── Redis + Queue singleton ──────────────────────────────────────────────────

let _renderConnection: IORedis | null = null;
function getRenderConnection(): IORedis {
  if (_renderConnection) return _renderConnection;
  const env = getEnv();
  _renderConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return _renderConnection;
}

const QUEUE_NAME = "social-render";

let _queue: Queue<SocialRenderJobData, SocialRenderJobResult> | null = null;
export function getSocialRenderQueue(): Queue<SocialRenderJobData, SocialRenderJobResult> {
  if (_queue) return _queue;
  _queue = new Queue<SocialRenderJobData, SocialRenderJobResult>(QUEUE_NAME, {
    connection: getRenderConnection(),
    defaultJobOptions: {
      // 1 retry — Remotion failures are usually deterministic; retry handles transient blips
      attempts: 2,
      backoff: { type: "fixed", delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });
  return _queue;
}

// ─── Enqueue helper ───────────────────────────────────────────────────────────

/**
 * Enqueue a Remotion render job for a social_post row.
 * By default uses `render-{socialPostId}` as jobId for idempotency (initial renders).
 * Pass `opts.jobId` to override — re-renders use a unique timestamp-based ID so BullMQ
 * doesn't deduplicate against a completed/failed job from the prior render.
 */
export async function enqueueSocialRenderJob(
  data: SocialRenderJobData,
  opts?: { jobId?: string },
): Promise<string> {
  const queue = getSocialRenderQueue();

  const job = await queue.add("render", data, {
    jobId: opts?.jobId ?? `render-${data.socialPostId}`,
  });

  // BullMQ always sets job.id to the provided jobId option — non-null is safe here.
  const jobId = job.id!;

  await db
    .update(socialPosts)
    .set({ renderJobId: jobId, renderStatus: "pending" })
    .where(eq(socialPosts.id, data.socialPostId));

  log.info({ socialPostId: data.socialPostId, jobId }, "Social render job enqueued");

  return jobId;
}

export async function closeSocialRenderQueue(): Promise<void> {
  if (_queue) await _queue.close();
  if (_renderConnection) await _renderConnection.quit();
}
