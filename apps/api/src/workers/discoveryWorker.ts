import { discoverArticleStep } from "@marketing-auto/pipelines";
import { articleDiscovery, articles, db, and, eq, templateRenders } from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";

const log = createLogger("discovery-worker");

let _connection: IORedis | null = null;
function getConnection(): IORedis {
  if (_connection) return _connection;
  const env = getEnv();
  _connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
  return _connection;
}

export const DISCOVERY_QUEUE_NAME = "discovery";

let _queue: Queue | null = null;
export function getDiscoveryQueue(): Queue {
  if (_queue) return _queue;
  _queue = new Queue(DISCOVERY_QUEUE_NAME, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: 1, // paid LLM jobs: no retry
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 100 },
    },
  });
  return _queue;
}

const discoverJobSchema = z.object({
  type: z.literal("discover-article").default("discover-article"),
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  mode: z.enum(["deterministic_only", "full"]),
  forceRefresh: z.boolean().optional(),
});

const renderJobSchema = z.object({
  type: z.literal("render-template"),
  templateRenderId: z.string().uuid(),
});

export function startDiscoveryWorker() {
  return new Worker(
    DISCOVERY_QUEUE_NAME,
    async (job: Job) => {
      const raw = job.data as Record<string, unknown>;

      if (raw["type"] === "render-template") {
        const data = renderJobSchema.parse(raw);
        await handleRenderTemplateJob(data.templateRenderId);
        return;
      }

      // default: discover-article
      const data = discoverJobSchema.parse({ ...raw, type: "discover-article" });
      const result = await discoverArticleStep({
        articleId: data.articleId,
        projectId: data.projectId,
        mode: data.mode,
        forceRefresh: data.forceRefresh ?? false,
      });
      if (result.status === "failed") {
        log.error({ articleId: data.articleId, error: result.error }, "Discovery job failed");
      } else {
        log.info(
          { articleId: data.articleId, status: result.status, durationMs: result.durationMs },
          "Discovery job done",
        );
      }
      return result;
    },
    { connection: getConnection(), concurrency: 3 },
  );
}

async function handleRenderTemplateJob(templateRenderId: string): Promise<void> {
  const startedAt = Date.now();

  const [render] = await db
    .select()
    .from(templateRenders)
    .where(eq(templateRenders.id, templateRenderId))
    .limit(1);
  if (!render) {
    log.error({ templateRenderId }, "Template render row not found");
    return;
  }

  await db
    .update(templateRenders)
    .set({ status: "rendering" })
    .where(eq(templateRenders.id, templateRenderId));

  try {
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, render.articleId))
      .limit(1);
    if (!article) throw new Error(`Article ${render.articleId} not found`);

    const [discovery] = await db
      .select()
      .from(articleDiscovery)
      .where(eq(articleDiscovery.articleId, render.articleId))
      .limit(1);
    if (!discovery) throw new Error(`Discovery not found for article ${render.articleId}`);

    // Dynamic import — avoids bundling Remotion into non-render contexts.
    // bootstrapTemplates() must be called here because this worker runs in a separate
    // process from server.ts (which normally bootstraps at startup).
    const socialTemplates = await import("@marketing-auto/social/templates") as unknown as {
      templateRegistry: { getById: (key: string) => import("@marketing-auto/social/templates").TemplateDefinition };
      bootstrapTemplates: () => void;
    };
    socialTemplates.bootstrapTemplates();

    const template = socialTemplates.templateRegistry.getById(render.templateKey);

    // If the stored renderInput was built from a different-locale article (e.g. EN article
    // queued with locale=de), rebuild it from the correct sibling before rendering.
    let renderInput = render.renderInput;
    if (render.locale && article.locale && render.locale !== article.locale && article.translationKey) {
      const [sibling] = await db
        .select()
        .from(articles)
        .where(
          and(
            eq(articles.projectId, article.projectId),
            eq(articles.translationKey, article.translationKey),
            eq(articles.locale, render.locale),
          )
        )
        .limit(1);
      if (sibling) {
        renderInput = (await template.buildInput(
          sibling as import("@marketing-auto/db").Article,
          discovery as import("@marketing-auto/db").ArticleDiscovery,
        )) as Record<string, unknown>;
        log.info({ templateRenderId, siblingId: sibling.id, locale: render.locale }, "Rebuilt renderInput from locale sibling");
      }
    }

    // Build the llmCaller for hook generation (dependency-injected to keep social package adapter-free)
    const { anthropic } = await import("@marketing-auto/adapter-anthropic");
    const locale = render.locale as import("@marketing-auto/social/templates").Locale;
    const llmCaller: import("@marketing-auto/social/templates").HookLlmCaller = async (systemPrompt, userPrompt) => {
      try {
        const resp = await anthropic.messages({
          projectId: article.projectId,
          operation: "SOCIAL_HOOK_GENERATION",
          model: "claude-haiku-4-5",
          systemPrefix: "",
          systemSuffix: systemPrompt,
          userMessage: userPrompt,
          maxTokens: 256,
          estimatedCostEur: 0.001,
          jsonMode: true,
        });
        return resp.raw;
      } catch {
        return null;
      }
    };

    const hookOutput = await template.generateHook(
      article as import("@marketing-auto/db").Article,
      renderInput,
      locale,
      llmCaller,
    );

    const renderResult = await template.render({
      article: article as import("@marketing-auto/db").Article,
      discovery: discovery as import("@marketing-auto/db").ArticleDiscovery,
      locale,
      theme: render.theme as import("@marketing-auto/social/templates").Theme,
      input: renderInput,
      hookOutput,
    });

    await db
      .update(templateRenders)
      .set({
        status: "ready",
        outputFiles: {
          slides: renderResult.slides,
          caption: renderResult.caption,
          hashtags: renderResult.hashtags,
        },
        costUsd: String(renderResult.metadata.estimatedCostUsd),
        durationMs: Date.now() - startedAt,
        completedAt: new Date(),
      })
      .where(eq(templateRenders.id, templateRenderId));

    log.info({ templateRenderId, durationMs: Date.now() - startedAt }, "Template render complete");
  } catch (err) {
    await db
      .update(templateRenders)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
        completedAt: new Date(),
      })
      .where(eq(templateRenders.id, templateRenderId));
    log.error({ templateRenderId, err }, "Template render failed");
  }
}

export async function enqueueDiscoveryJob(opts: {
  articleId: string;
  projectId: string;
  mode: "deterministic_only" | "full";
  forceRefresh?: boolean;
}): Promise<{ jobId: string }> {
  const queue = getDiscoveryQueue();
  const job = await queue.add(
    "discover-article",
    { type: "discover-article", articleId: opts.articleId, projectId: opts.projectId, mode: opts.mode, forceRefresh: opts.forceRefresh ?? false },
    { jobId: `discovery-${opts.articleId}` },
  );
  return { jobId: job.id ?? `discovery-${opts.articleId}` };
}

export async function enqueueTemplateRenderJob(templateRenderId: string): Promise<{ jobId: string }> {
  const queue = getDiscoveryQueue();
  const job = await queue.add(
    "render-template",
    { type: "render-template", templateRenderId },
    { jobId: `render-template-${templateRenderId}` },
  );
  return { jobId: job.id ?? `render-template-${templateRenderId}` };
}
