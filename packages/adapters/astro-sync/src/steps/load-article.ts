import { articles, clusters, db, pipelineRuns, projects } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type AstroRepoConfig, AstroRepoConfigSchema, AstroSyncError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
});

const OutputSchema = z.object({
  article: z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    metaDescription: z.string(),
    bodyMd: z.string(),
    cornerstoneKeyword: z.string(),
    heroImagePublicUrl: z.string().url(),
    heroImageAltText: z.string(),
    schemaJsonLd: z.array(z.record(z.unknown())),
    collectionType: z.string(),
    wordCount: z.number(),
  }),
  cluster: z
    .object({
      name: z.string(),
      pillar: z.string(),
    })
    .nullable(),
  // AstroRepoConfigSchema has .default() fields → _input has string|undefined.
  // Cast to ZodType<output> to satisfy BaseStep's strict generic (safe: .parse() always returns output).
  astroRepo: AstroRepoConfigSchema,
});
type LoadArticleOutput = z.infer<typeof OutputSchema>;
const OutputSchemaCast = OutputSchema as z.ZodType<LoadArticleOutput>;

export class LoadArticleStep extends BaseStep<z.infer<typeof InputSchema>, LoadArticleOutput> {
  readonly name = "load-article";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchemaCast;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);

    if (!article) {
      throw new AstroSyncError(`Article ${input.articleId} not found`, "load");
    }

    // Stale-read guard: abort if the article was modified after the pipeline run was created.
    // This prevents committing stale content when the user edits the article while the sync is queued.
    const [run] = await db
      .select({ createdAt: pipelineRuns.createdAt })
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, ctx.pipelineRunId))
      .limit(1);

    if (run && article.updatedAt > run.createdAt) {
      throw new AstroSyncError(
        `stale_read: article was updated at ${article.updatedAt.toISOString()} after pipeline run started at ${run.createdAt.toISOString()}. Trigger a new sync to pick up the latest content.`,
        "stale_read"
      );
    }

    if (article.status !== "final_review" && article.status !== "ready_to_publish") {
      throw new AstroSyncError(
        `Article status is "${article.status}", expected "final_review" or "ready_to_publish"`,
        "load"
      );
    }

    if (!article.bodyMd || !article.heroImagePublicUrl || !article.title) {
      throw new AstroSyncError(
        "Article missing required fields (bodyMd, heroImagePublicUrl, or title)",
        "load"
      );
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, article.projectId))
      .limit(1);

    if (!project) {
      throw new AstroSyncError(`Project ${article.projectId} not found`, "load");
    }

    if (!project.astroRepo) {
      throw new AstroSyncError(
        `Project "${project.slug}" has no astroRepo configured. Set projects.astro_repo first.`,
        "config"
      );
    }

    const astroRepo = AstroRepoConfigSchema.parse(project.astroRepo) as AstroRepoConfig;

    let cluster: { name: string; pillar: string } | null = null;
    if (article.clusterId) {
      const [c] = await db
        .select()
        .from(clusters)
        .where(eq(clusters.id, article.clusterId))
        .limit(1);
      if (c) cluster = { name: c.name, pillar: c.pillar ?? "general" };
    }

    return {
      article: {
        id: article.id,
        projectId: article.projectId,
        slug: article.slug,
        title: article.title,
        metaDescription: article.metaDescription ?? "",
        bodyMd: article.bodyMd,
        cornerstoneKeyword: article.cornerstoneKeyword,
        heroImagePublicUrl: article.heroImagePublicUrl,
        heroImageAltText: article.heroImageAltText ?? article.title,
        schemaJsonLd: (article.schemaJsonLd as Array<Record<string, unknown>>) ?? [],
        collectionType: article.collectionType,
        wordCount: article.wordCount ?? article.bodyMd.split(/\s+/).length,
      },
      cluster,
      astroRepo,
    };
  }
}
