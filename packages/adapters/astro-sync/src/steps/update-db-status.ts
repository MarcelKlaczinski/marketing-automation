import { articles, astroSyncRuns, db } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  commitSha: z.string(),
  filesCommitted: z.array(z.string()),
  bytesCommitted: z.number(),
  frontmatter: z.record(z.unknown()),
  heroAstroAssetPath: z.string(),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  syncRunId: z.string().uuid(),
});

export class UpdateDbStatusStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "update-db-status";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const now = new Date();

    await db
      .update(articles)
      .set({
        status: "ready_to_publish",
        astroSyncedAt: now,
        astroCommitSha: input.commitSha,
        astroFrontmatter: input.frontmatter,
        astroAssetPaths: { heroImage: input.heroAstroAssetPath },
        updatedAt: now,
      })
      .where(eq(articles.id, input.articleId));

    const [syncRun] = await db
      .insert(astroSyncRuns)
      .values({
        projectId: input.projectId,
        articleId: input.articleId,
        pipelineRunId: ctx.pipelineRunId,
        status: "succeeded",
        commitSha: input.commitSha,
        filesCommitted: input.filesCommitted,
        bytesCommitted: input.bytesCommitted,
        finishedAt: now,
      })
      .returning();

    return {
      articleId: input.articleId,
      syncRunId: syncRun!.id,
    };
  }
}
