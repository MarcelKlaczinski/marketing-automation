// Spec 57.2: BullMQ worker that performs async Remotion rendering.
// concurrency: 1 — Chromium memory hygiene (parallel renders in same process risk OOM).
// All render inputs come from job.data snapshot; DB writes are status transitions only.
import { Worker } from "bullmq";
import { publishPipelineEvent } from "@marketing-auto/core/events";
import { type RenderError, db, eq, socialPosts, sql } from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";
import IORedis from "ioredis";
import { z } from "zod";
import { getSocialRenderQueue, type SocialRenderJobData, type SocialRenderJobResult } from "./social-render.queue.ts";

const log = createLogger("workers:social-render");

// ─── Runtime Zod validation for job.data (arrives as unknown from Redis) ─────

const socialRenderJobDataSchema = z.object({
  socialPostId: z.string().uuid(),
  projectId: z.string().uuid(),
  articleId: z.string().uuid(),
  templateKey: z.string(),
  locale: z.string(),
  brandTokens: z.record(z.unknown()),
  overrides: z.record(z.unknown()),
  resolvedTools: z.array(z.record(z.unknown())),
  articleTitle: z.string(),
  articleSlug: z.string(),
  projectSlug: z.string(),
  articleUrl: z.string(),
  theme: z.string(),
  variant: z.string(),
  coverEyebrow: z.string(),
  coverHeadlineLead: z.string(),
  coverHeadlineHighlight: z.string(),
  coverHeadlineTrail: z.string().optional(),
  coverSubhead: z.string().optional(),
  endHeadline: z.string(),
  endHeadlineHighlight: z.string(),
  coverHookOutput: z.record(z.unknown()).optional(),
  endCloser: z.record(z.unknown()).optional(),
});

// ─── Remotion render (real impl wired in Session 3) ──────────────────────────

async function renderSlidesViaRemotion(_data: SocialRenderJobData): Promise<{ slideUrls: string[] }> {
  // Session 3 will replace this stub with the actual Remotion + R2 upload logic
  // extracted from the former synchronous RenderSlidesStep + UploadSlidesStep.
  throw new Error("renderSlidesViaRemotion: not yet implemented (Session 3)");
}

// ─── Worker factory ───────────────────────────────────────────────────────────

export function startSocialRenderWorker(): Worker<SocialRenderJobData, SocialRenderJobResult> {
  const env = getEnv();
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

  // Ensure queue is initialised so the shared singleton is usable from the worker process too
  getSocialRenderQueue();

  const worker = new Worker<SocialRenderJobData, SocialRenderJobResult>(
    "social-render",
    async (job) => {
      // Cast needed: Zod optional fields infer as `T | undefined` but SocialRenderJobData
      // uses `field?: T` — structurally compatible at runtime, exactOptionalPropertyTypes disagrees.
      const data = socialRenderJobDataSchema.parse(job.data) as SocialRenderJobData;
      const { socialPostId, projectId, articleId } = data;
      const ts = () => new Date().toISOString();

      // ── 1. Mark as rendering ──────────────────────────────────────────────
      await db
        .update(socialPosts)
        .set({ renderStatus: "rendering", renderStartedAt: new Date() })
        .where(eq(socialPosts.id, socialPostId));

      void publishPipelineEvent(projectId, {
        type: "social.render.started",
        socialPostId,
        projectId,
        articleId,
        timestamp: ts(),
      });

      // ── 2. Render ─────────────────────────────────────────────────────────
      let slideUrls: string[];
      try {
        const result = await renderSlidesViaRemotion(data);
        slideUrls = result.slideUrls;
      } catch (err) {
        const error = err as Error & { code?: string };
        log.error({ socialPostId, err }, "Render failed");

        const renderError: RenderError = {
          code: error.code ?? "RENDER_FAILED",
          message: error.message ?? "Unknown render error",
          attemptedAt: ts(),
          ...(error.stack !== undefined && { stack: error.stack }),
        };

        // Only write final failure to DB after all retry attempts are exhausted.
        // While retries remain, BullMQ re-queues from 'rendering' state.
        const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
        if (isLastAttempt) {
          await db
            .update(socialPosts)
            .set({
              renderStatus: "failed",
              renderError,
              renderCompletedAt: new Date(),
            })
            .where(eq(socialPosts.id, socialPostId));

          void publishPipelineEvent(projectId, {
            type: "social.render.failed",
            socialPostId,
            projectId,
            articleId,
            error: renderError.message,
            timestamp: ts(),
          });
        }

        throw err; // let BullMQ handle retry vs final-fail
      }

      // ── 3. Persist slide URLs + mark rendered ─────────────────────────────
      // Update the slides array inside the existing content JSONB.
      // Use Drizzle update with jsonb_set so the rest of content (caption, hashtags) is preserved.
      const slidesJson = JSON.stringify(slideUrls.map((url) => ({ imageUrl: url })));
      await db
        .update(socialPosts)
        .set({
          renderStatus: "rendered",
          renderCompletedAt: new Date(),
          content: sql`jsonb_set(${socialPosts.content}, '{slides}', ${slidesJson}::jsonb)`,
        })
        .where(eq(socialPosts.id, socialPostId));

      void publishPipelineEvent(projectId, {
        type: "social.render.completed",
        socialPostId,
        projectId,
        articleId,
        slideCount: slideUrls.length,
        timestamp: ts(),
      });

      log.info({ socialPostId, slideCount: slideUrls.length }, "Render completed");

      return { socialPostId, slideUrls, totalSlides: slideUrls.length };
    },
    {
      connection,
      concurrency: 1,
      // Remotion renders can take 10-30s; default lockDuration (30s) is too tight
      lockDuration: 5 * 60 * 1000,       // 5 minutes
      stalledInterval: 10 * 60 * 1000,   // check for stalled jobs every 10 minutes
      maxStalledCount: 1,                 // allow one retry on stall (transient worker crash)
    }
  );

  worker.on("ready", () => log.info("social-render worker ready (concurrency=1)"));
  worker.on("error", (err) => log.error({ err }, "social-render worker error"));

  return worker;
}
