import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { COST_OPS } from "@marketing-auto/core";
import { and, articles, db, eq, inArray, projects, topicBriefs } from "@marketing-auto/db";
import { enqueueBlogGenerationPipeline } from "@marketing-auto/pipelines";
import { type ArticleCollectionType, createLogger } from "@marketing-auto/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.ts";
import {
  triggerWithPreRunId,
  triggerResultToResponse,
} from "../_lib/trigger-helpers.ts";

// Spec 61.2: Astro folder name (text) ↔ DB enum mapping for the standalone endpoint.
// Mirrors COLLECTION_FOLDER (render-mdx.ts) + COLLECTION_ASTRO_NAME (persist-article.ts)
// from the other direction: the UI sends the user-facing Astro folder name, this maps
// it to the enum that drives pipeline routing.
const ASTRO_FOLDER_TO_COLLECTION_TYPE: Record<string, ArticleCollectionType> = {
  blog: "blog",
  comparisons: "comparison",
  "ki-wissen": "ki-wissen",
  tools: "tools",
  usecases: "usecases",
};

const log = createLogger("routes:articles-standalone");

export const articleStandaloneRoutes = new Hono();

articleStandaloneRoutes.use(requireAuth);

const standaloneGenerateSchema = z
  .object({
    topic: z.string().min(5).max(200),
    primaryKeyword: z.string().min(2).max(100),
    collection: z.enum(["blog", "tools", "comparisons", "ki-wissen", "usecases", "tool-categories"]),
    locale: z.enum(["de", "en"]),
    intentType: z
      .enum(["overview", "general", "review", "comparison", "pricing", "tutorial", "use-cases", "features"])
      .default("general"),
    authorSlug: z.string().optional(),
    clusterId: z.string().uuid().optional(),
    // "assist" maps to DB "manual" approval mode
    approvalMode: z.enum(["assist", "auto"]).default("assist"),
    estimatedWordCount: z.number().int().min(500).max(5000).default(2000),
    // Spec 61.2: comparisons require 2-4 tool slugs from the tools collection
    toolSlugs: z.array(z.string().min(1).max(60)).min(2).max(4).optional(),
  })
  .refine(
    (v) => v.collection !== "comparisons" || (v.toolSlugs && v.toolSlugs.length >= 2),
    { message: "comparisons require toolSlugs (2-4)", path: ["toolSlugs"] },
  );

function slugifyTopic(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 80);
}

// POST /:slug/articles/generate-standalone — from-scratch single article wizard (Spec 56.3 §A.2)
articleStandaloneRoutes.post(
  "/:slug/articles/generate-standalone",
  zValidator("json", standaloneGenerateSchema),
  async (c) => {
    const { slug } = c.req.param();
    const input = c.req.valid("json");

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "project_not_found" }, 404);

    const articleId = randomUUID();
    const articleSlug = slugifyTopic(input.topic);
    const dbApprovalMode = input.approvalMode === "auto" ? "auto" : "manual";

    // Spec 61.2: derive collection enum from the Astro folder name the UI sent.
    // Unmapped folder names (e.g. "tool-categories") fall back to "blog" — the
    // DB column accepts the broader text in `collection`, but `collectionType`
    // (enum) only carries the values that have pipeline support.
    const collectionType: ArticleCollectionType =
      ASTRO_FOLDER_TO_COLLECTION_TYPE[input.collection] ?? "blog";

    // Spec 61.2: resolve tool display names for the comparison prompt.
    // Missing rows fall back to the slug; the pipeline tolerates either.
    let comparisonToolNames: string[] | undefined;
    if (collectionType === "comparison" && input.toolSlugs?.length) {
      const rows = await db
        .select({ slug: articles.slug, title: articles.title })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, project.id),
            eq(articles.collection, "tools"),
            inArray(articles.slug, input.toolSlugs),
          ),
        );
      const byslug = new Map(rows.map((r) => [r.slug, r.title]));
      comparisonToolNames = input.toolSlugs.map((s) => byslug.get(s) ?? s);
    }

    // Insert the brief first so the pipeline worker finds it on startup
    const briefRows = await db
      .insert(topicBriefs)
      .values({
        projectId: project.id,
        source: "manual",
        topicTitle: input.topic,
        primaryKeyword: input.primaryKeyword,
        locale: input.locale,
        intentType: input.intentType,
        clusterId: input.clusterId ?? null,
        clusterAction: input.clusterId ? "append_to_existing" : "standalone",
        suggestedTitle: input.topic,
        suggestedSlug: articleSlug,
        suggestedMeta: "",
        approvalStatus: "approved",
        approvedBy: "user",
        approvedAt: new Date(),
        routedArticleId: articleId,
      })
      .returning();

    const briefId = briefRows[0]!.id;

    // Insert the article stub (title/body filled by pipeline)
    await db.insert(articles).values({
      id: articleId,
      projectId: project.id,
      slug: articleSlug,
      cornerstoneKeyword: input.primaryKeyword,
      locale: input.locale,
      source: "generated",
      collection: input.collection,
      status: "proposed",
      intentType: input.intentType,
      approvalMode: dbApprovalMode,
      clusterId: input.clusterId ?? null,
      author: input.authorSlug ?? null,
    });

    // Spec 61.2: forward collectionType + comparison tool list into the pipeline.
    // `enqueueBlogGenerationPipeline` only declares the four required fields, but
    // `enqueuePipeline` accepts the full `BlogPipelineInput` shape (Zod validates
    // at job pickup time). The pipeline_runs.input JSONB carries the extras.
    const extraInput: Record<string, unknown> = { articleId, briefId };
    if (collectionType !== "blog") extraInput.collectionType = collectionType;
    if (input.toolSlugs?.length) extraInput.comparisonToolSlugs = input.toolSlugs;
    if (comparisonToolNames?.length) extraInput.comparisonToolNames = comparisonToolNames;

    // Trigger the blog pipeline (handles pause + cost + idempotency + pipeline_runs + enqueue).
    // Spec 64.7: standalone generations are immediate by design (fast feedback for
    // the "try it now" wizard). Pinning overrideLlmMode='sync' here means even if
    // projects.llmMode is "batch" the standalone run won't suspend at HeroImageStep.
    const result = await triggerWithPreRunId({
      pipelineName: "article:blog",
      projectId: project.id,
      uniqueKey: { field: "articleId", value: articleId },
      costEstimate: { service: "anthropic", operation: COST_OPS.ARTICLE_OUTLINE },
      extraInput,
      overrideLlmMode: "sync",
      enqueue: enqueueBlogGenerationPipeline,
    });

    if ("error" in result) {
      log.warn(
        { error: result.error, projectId: project.id, articleId },
        "Standalone article generation blocked",
      );
      return triggerResultToResponse(c, result);
    }

    log.info(
      { articleId, briefId: briefId, runId: result.runId },
      "Standalone article generation enqueued",
    );

    return c.json(
      {
        ok: true,
        data: {
          articleId,
          briefId: briefId,
          runId: result.runId,
          jobId: result.jobId,
        },
      },
      202,
    );
  },
);
