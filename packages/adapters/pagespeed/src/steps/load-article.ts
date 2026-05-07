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
    astroCommitSha: string;
  };
  astroRepo: z.infer<typeof AstroRepoConfigSchema>;
  thresholds: z.infer<typeof PagespeedScoresSchema>;
  workDir: string;
};

const OutputSchema = z.object({
  article: z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    slug: z.string(),
    astroCommitSha: z.string(),
  }),
  astroRepo: AstroRepoConfigSchema,
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

    if (article.status !== "ready_to_publish" && article.status !== "blocked_by_pagespeed") {
      throw new PagespeedError(
        `Article status is "${article.status}", expected "ready_to_publish" or "blocked_by_pagespeed" (re-run after fix)`,
        "config"
      );
    }

    if (!article.astroCommitSha) {
      throw new PagespeedError("Article has no astroCommitSha — sync via Spec 21 first", "config");
    }

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, article.projectId))
      .limit(1);

    if (!project) {
      throw new PagespeedError(`Project ${article.projectId} not found`, "config");
    }

    if (!project.astroRepo) {
      throw new PagespeedError(
        `Project "${project.slug}" has no astroRepo configured (set via Spec 21 setup)`,
        "config"
      );
    }

    const env = getEnv();
    const workDir = `${env.PAGESPEED_WORK_DIR}/${project.slug}/${ctx.pipelineRunId}`;

    return {
      article: {
        id: article.id,
        projectId: article.projectId,
        slug: article.slug,
        astroCommitSha: article.astroCommitSha,
      },
      astroRepo: AstroRepoConfigSchema.parse(project.astroRepo),
      thresholds: PagespeedScoresSchema.parse(project.pagespeedThresholds),
      workDir,
    };
  }
}
