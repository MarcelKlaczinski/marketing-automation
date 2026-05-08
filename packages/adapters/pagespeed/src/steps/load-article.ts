import { AstroRepoConfigSchema } from "@marketing-auto/adapter-astro-sync";
import { articles, db, projects } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { getEnv } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { PagespeedError, PagespeedScoresSchema } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
});

type LoadArticleOutput = {
  article: {
    id: string;
    projectId: string;
    slug: string;
    locale: string;
    collection: string;
    astroCommitSha: string | null;
  };
  astroRepo: z.infer<typeof AstroRepoConfigSchema> | null;
  thresholds: z.infer<typeof PagespeedScoresSchema>;
  workDir: string;
};

const OutputSchema = z.object({
  article: z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    slug: z.string(),
    locale: z.string(),
    collection: z.string(),
    astroCommitSha: z.string().nullable(),
  }),
  astroRepo: AstroRepoConfigSchema.nullable(),
  thresholds: PagespeedScoresSchema,
  workDir: z.string(),
}) as z.ZodType<LoadArticleOutput>;
// ZodType cast: AstroRepoConfigSchema has .default() fields causing _input variance

export class LoadArticleStep extends BaseStep<z.infer<typeof InputSchema>, LoadArticleOutput> {
  readonly name = "load-article";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext): Promise<LoadArticleOutput> {
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);

    if (!article) {
      throw new PagespeedError(`Article ${input.articleId} not found`, "config");
    }

    // Status gate removed in Spec 22.5 — both local and API modes work for any article status.
    // Local mode callers (pipeline bridge) still check astroCommitSha before using it.

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, article.projectId))
      .limit(1);

    if (!project) {
      throw new PagespeedError(`Project ${article.projectId} not found`, "config");
    }

    const env = getEnv();
    const workDir = `${env.PAGESPEED_WORK_DIR}/${project.slug}/${ctx.pipelineRunId}`;

    return {
      article: {
        id: article.id,
        projectId: article.projectId,
        slug: article.slug,
        locale: article.locale,
        collection: article.collection,
        astroCommitSha: article.astroCommitSha ?? null,
      },
      astroRepo: project.astroRepo ? AstroRepoConfigSchema.parse(project.astroRepo) : null,
      thresholds: PagespeedScoresSchema.parse(project.pagespeedThresholds),
      workDir,
    };
  }
}
