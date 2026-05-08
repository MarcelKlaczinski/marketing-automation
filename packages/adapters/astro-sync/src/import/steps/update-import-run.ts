import { astroImportRuns, db } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";

const InputSchema = z.object({
  importRunId: z.string().uuid(),
  filesDiscovered: z.number(),
  filesParsed: z.number(),
  articlesInserted: z.number(),
  articlesUpdated: z.number(),
  articlesUnchanged: z.number(),
  articlesFailed: z.number(),
  totalPairs: z.number(),
  orphans: z.number(),
  headCommitSha: z.string(),
});

const OutputSchema = z.object({
  importRunId: z.string().uuid(),
});

export class UpdateImportRunStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "update-import-run";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    await db
      .update(astroImportRuns)
      .set({
        status: "succeeded",
        filesDiscovered: input.filesDiscovered,
        filesParsed: input.filesParsed,
        articlesInserted: input.articlesInserted,
        articlesUpdated: input.articlesUpdated,
        articlesUnchanged: input.articlesUnchanged,
        articlesFailed: input.articlesFailed,
        pairsLinked: input.totalPairs,
        orphanedArticles: input.orphans,
        headCommitSha: input.headCommitSha,
        finishedAt: new Date(),
      })
      .where(eq(astroImportRuns.id, input.importRunId));

    return { importRunId: input.importRunId };
  }
}
