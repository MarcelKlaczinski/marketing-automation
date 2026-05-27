// Spec 57.2: BullMQ worker that performs async Remotion rendering.
// concurrency: 1 — Chromium memory hygiene (parallel renders in same process risk OOM).
// All render inputs come from job.data snapshot; DB writes are status transitions only.
import { Worker } from "bullmq";
import { publishPipelineEvent } from "@marketing-auto/core/events";
import { notifyPipelineCompletion } from "@marketing-auto/core/notifications";
import { type RenderError, db, eq, socialPosts, sql } from "@marketing-auto/db";
import { r2 } from "@marketing-auto/adapter-storage";
import { createLogger, getEnv } from "@marketing-auto/shared";
import IORedis from "ioredis";
import { z } from "zod";
import { getSocialRenderQueue, type SocialRenderJobData, type SocialRenderJobResult } from "@marketing-auto/pipelines/social-render-queue";
import type {
  DeprecatedTemplateKey,
  TemplateKey,
  UnsupportedTemplateKey,
} from "@marketing-auto/social/templates";
import { syncRecurringArticleStatus } from "../lib/recurring-content/sync-article-status.ts";

const log = createLogger("workers:social-render");

// ─── Template-key dispatch sets (Spec 65.7-followup) ─────────────────────────
// Family A: single-still + multi-slide carousels that use the snapshot-pattern
// with a flat composition input (the snapshot IS the input). The worker reads
// social_posts.content.renderInput, spreads fresh brandTokens + overrides from
// job-data, and dispatches to the matching render-server function.
const FAMILY_A_TEMPLATE_KEYS = [
  "comparison-grid-3",
  "comparison-grid-4",
  "comparison-grid-5",
  "verdict-per-use-case",
  "single-tool-spotlight",
  "pro-con-verdict",
  "head-to-head-vs",
  "head-to-head-deep-dive",
] as const satisfies readonly TemplateKey[];

type FamilyATemplateKey = (typeof FAMILY_A_TEMPLATE_KEYS)[number];

// Family B: photographic carousels (Spec 65.8). Snapshot has shape
// `{ kind: "family-b", templateKey, locale, theme, slideTotal, compositionInput }`
// — the worker spreads compositionInput plus fresh brandTokens + overrides.
const FAMILY_B_TEMPLATE_KEYS = [
  "story-arc-clickbait",
  "lifestyle-listicle",
  "opinion-recommendation",
] as const satisfies readonly TemplateKey[];

type FamilyBTemplateKey = (typeof FAMILY_B_TEMPLATE_KEYS)[number];

// `UnsupportedTemplateKey` ("never shipped, future maybe") and
// `DeprecatedTemplateKey` ("planned, V1-cut, ships as config-knob now") both
// live in `@marketing-auto/social/templates/types.ts` as the canonical
// classification surface. Imported above so the exhaustivity guard catches
// any future TemplateKey addition that lands without being assigned to one
// of the four categories.

// Compile-time guard: every TemplateKey must belong to FamilyA, FamilyB,
// Unsupported, or Deprecated. A new value in the union without a home
// triggers "Type 'X' does not satisfy the constraint 'never'." on the cast
// below. Spec 65.cleanup extended this from 3 to 4 categories.
type _AssertNever<T extends never> = T;
const _exhaustivityCheck = null as unknown as _AssertNever<
  Exclude<
    TemplateKey,
    FamilyATemplateKey | FamilyBTemplateKey | UnsupportedTemplateKey | DeprecatedTemplateKey
  >
>;
void _exhaustivityCheck;

export function isFamilyA(key: string): key is FamilyATemplateKey {
  return (FAMILY_A_TEMPLATE_KEYS as readonly string[]).includes(key);
}

export function isFamilyB(key: string): key is FamilyBTemplateKey {
  return (FAMILY_B_TEMPLATE_KEYS as readonly string[]).includes(key);
}

// Re-export for tests + future Settings-UI consumers that want to surface
// the dispatch-coverage matrix.
export { FAMILY_A_TEMPLATE_KEYS, FAMILY_B_TEMPLATE_KEYS };

// ─── Pure dispatcher (extracted for offline test coverage) ────────────────────
// Routes a templateKey + already-resolved composition input to the matching
// render-server function. Family-specific snapshot-read + brandTokens-spread
// happens in `renderSlidesViaRemotion`; `dispatchByTemplateKey` is the pure
// switch + sets-membership guard.
//
// The exhaustive `assertNever` in each switch's default branch + the
// type-level guard above guarantee that adding a TemplateKey value without
// extending one of the dispatch sets is a compile-time error in BOTH places.
export type RenderServerLike = {
  renderComparisonGrid3: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
  renderComparisonGrid4: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
  renderComparisonGrid5: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
  renderVerdictPerUseCase: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
  renderSingleToolSpotlight: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
  renderProConVerdict: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
  renderHeadToHeadVs: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
  renderHeadToHeadDeepDive: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
  renderStoryArcClickbait: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
  renderLifestyleListicle: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
  renderOpinionRecommendation: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
};

export async function dispatchByTemplateKey(
  templateKey: string,
  fullInput: Record<string, unknown>,
  renderServer: RenderServerLike,
): Promise<{ slides: Buffer[]; sequenceCount: number }> {
  if (isFamilyB(templateKey)) {
    switch (templateKey) {
      case "story-arc-clickbait":
        return renderServer.renderStoryArcClickbait(fullInput);
      case "lifestyle-listicle":
        return renderServer.renderLifestyleListicle(fullInput);
      case "opinion-recommendation":
        return renderServer.renderOpinionRecommendation(fullInput);
      default: {
        const _exhaustive: never = templateKey;
        throw new Error(`Unhandled Family-B templateKey: ${String(_exhaustive)}`);
      }
    }
  }
  if (isFamilyA(templateKey)) {
    switch (templateKey) {
      case "comparison-grid-3":
        return renderServer.renderComparisonGrid3(fullInput);
      case "comparison-grid-4":
        return renderServer.renderComparisonGrid4(fullInput);
      case "comparison-grid-5":
        return renderServer.renderComparisonGrid5(fullInput);
      case "verdict-per-use-case":
        return renderServer.renderVerdictPerUseCase(fullInput);
      case "single-tool-spotlight":
        return renderServer.renderSingleToolSpotlight(fullInput);
      case "pro-con-verdict":
        return renderServer.renderProConVerdict(fullInput);
      case "head-to-head-vs":
        return renderServer.renderHeadToHeadVs(fullInput);
      case "head-to-head-deep-dive":
        return renderServer.renderHeadToHeadDeepDive(fullInput);
      default: {
        const _exhaustive: never = templateKey;
        throw new Error(`Unhandled Family-A templateKey: ${String(_exhaustive)}`);
      }
    }
  }
  throw new Error(`Unknown templateKey: ${templateKey}`);
}

// Read the renderInput snapshot persisted by RenderSlidesStep at INSERT time.
// Shared by Family-A + Family-B branches.
async function loadRenderSnapshot(
  socialPostId: string,
  templateKey: string,
): Promise<Record<string, unknown>> {
  const [post] = await db
    .select({ content: socialPosts.content })
    .from(socialPosts)
    .where(eq(socialPosts.id, socialPostId));
  const contentRecord = post?.content as Record<string, unknown> | null | undefined;
  const snapshot = contentRecord?.renderInput as Record<string, unknown> | undefined;
  if (!snapshot) {
    throw new Error(
      `No renderInput snapshot in social_posts.content for post ${socialPostId} (templateKey: ${templateKey})`,
    );
  }
  return snapshot;
}

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

async function renderSlidesViaRemotion(data: SocialRenderJobData): Promise<{ slideUrls: string[] }> {
  const templateKey = data.templateKey;

  // Dynamic import: avoids Remotion bundling into API startup context (per packages/social CLAUDE.md).
  // Import from the /render-server subpath (pure .ts, no JSX) so the API tsconfig doesn't need --jsx.
  const renderServer = (await import("@marketing-auto/social/render-server")) as unknown as {
    // Family A (Spec 60.1/60.2/60.3/60.4/60.5 + Spec 65.7 multi-slide carousels)
    renderComparisonGrid3: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    renderComparisonGrid4: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    renderComparisonGrid5: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    renderVerdictPerUseCase: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    renderSingleToolSpotlight: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    renderProConVerdict: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    renderHeadToHeadVs: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    renderHeadToHeadDeepDive: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    // Family B (Spec 65.8 photographic carousels)
    renderStoryArcClickbait: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    renderLifestyleListicle: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    renderOpinionRecommendation: (input: Record<string, unknown>) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
  };

  // ─── Build composition input from snapshot (family-specific) ────────────────
  // Three snapshot shapes coexist:
  //   1. Family-B: `{ kind: "family-b", compositionInput, ... }` — nested.
  //   2. Family-A multi-slide (Spec 65.7-followup-2): same nested shape with
  //      `kind: "family-a-multi-slide"`. Discriminator is needed because the
  //      4 multi-slide carousels' snapshots carry `slideTotal` + the full
  //      template-built composition input that RenderSlidesStep pre-assembled
  //      via `family-a-multi-slide-render.ts`.
  //   3. Family-A single-still + legacy list-carousel: flat — the persisted
  //      renderInput IS the composition input. Stays untouched.
  // All paths spread fresh brandTokens + overrides from job-data on top.
  let fullInput: Record<string, unknown>;
  if (isFamilyB(templateKey)) {
    const snapshot = (await loadRenderSnapshot(data.socialPostId, templateKey)) as {
      kind?: string;
      compositionInput?: Record<string, unknown>;
    };
    if (snapshot.kind !== "family-b" || !snapshot.compositionInput) {
      throw new Error(
        `Family-B snapshot mismatch in social_posts.content for post ${data.socialPostId} (templateKey: ${templateKey}, kind: ${snapshot.kind ?? "missing"})`,
      );
    }
    fullInput = {
      ...snapshot.compositionInput,
      brandTokens: data.brandTokens,
      overrides: data.overrides,
    };
  } else if (isFamilyA(templateKey)) {
    const snapshot = (await loadRenderSnapshot(data.socialPostId, templateKey)) as {
      kind?: string;
      compositionInput?: Record<string, unknown>;
    } & Record<string, unknown>;
    if (snapshot.kind === "family-a-multi-slide") {
      if (!snapshot.compositionInput) {
        throw new Error(
          `Family-A multi-slide snapshot missing compositionInput for post ${data.socialPostId} (templateKey: ${templateKey})`,
        );
      }
      fullInput = {
        ...snapshot.compositionInput,
        brandTokens: data.brandTokens,
        overrides: data.overrides,
      };
    } else {
      // Flat snapshot — Family-A single-still (grid-4, verdict-per-use-case,
      // single-tool-spotlight, pro-con-verdict) and any pre-65.7-followup-2
      // rows that may still exist.
      fullInput = {
        ...snapshot,
        brandTokens: data.brandTokens,
        overrides: data.overrides,
      };
    }
  } else {
    throw new Error(`Unknown templateKey: ${templateKey}`);
  }

  const result = await dispatchByTemplateKey(templateKey, fullInput, renderServer);
  const slides = result.slides;

  // Upload each PNG buffer to R2 and collect public URLs
  const timestamp = Date.now();
  const slideUrls: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const key = `${data.projectSlug}/social/${data.articleSlug}-${timestamp}-slide-${i}.png`;
    const result = await r2.put({
      key,
      body: slides[i]!,
      contentType: "image/png",
    });
    slideUrls.push(result.publicUrl);
  }

  return { slideUrls };
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
          totalSlides: slideUrls.length,
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

  // Spec 64.11 Fix B: completion + failure notifications. Listener is async +
  // fire-and-forget — failures are swallowed inside notifyPipelineCompletion so
  // a notification miss never escalates into a job retry.
  // Spec 65.10: also sync recurring-content article status on the same event.
  worker.on("completed", (job, result) => {
    void notifyPipelineCompletion({
      pipelineName: "social-render",
      projectId: job.data.projectId,
      pipelineRunId: String(job.id ?? "unknown"),
      articleId: job.data.articleId,
      socialPostId: result.socialPostId ?? job.data.socialPostId,
      status: "success",
    });
    void syncRecurringArticleStatus({
      articleId: job.data.articleId,
      outcome: "success",
    }).catch((err) =>
      log.warn({ err, articleId: job.data.articleId }, "syncRecurringArticleStatus(success) failed"),
    );
  });
  worker.on("failed", (job, error) => {
    if (!job) return; // BullMQ permits undefined here (rare: pre-job error)
    void notifyPipelineCompletion({
      pipelineName: "social-render",
      projectId: job.data.projectId,
      pipelineRunId: String(job.id ?? "unknown"),
      articleId: job.data.articleId,
      socialPostId: job.data.socialPostId,
      status: "failed",
      errorMessage: error.message,
    });
    void syncRecurringArticleStatus({
      articleId: job.data.articleId,
      outcome: "failed",
    }).catch((err) =>
      log.warn({ err, articleId: job.data.articleId }, "syncRecurringArticleStatus(failed) failed"),
    );
  });

  return worker;
}
