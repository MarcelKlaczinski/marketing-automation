import { type SelfReviewIssue, articles, db } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  bodyMd: z.string(),
  wordCount: z.number(),
  heroR2Key: z.string(),
  heroPublicUrl: z.string().url(),
  heroAltText: z.string(),
  selfReviewScore: z.number(),
  selfReviewIssues: z.array(z.unknown()),
  schemaJsonLd: z.record(z.unknown()),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  wordCount: z.number(),
  selfReviewScore: z.number(),
});

export class PersistArticleStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "persist-article";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    await db
      .update(articles)
      .set({
        bodyMd: input.bodyMd,
        wordCount: input.wordCount,
        heroImageR2Key: input.heroR2Key,
        heroImagePublicUrl: input.heroPublicUrl,
        heroImageAltText: input.heroAltText,
        selfReviewScore: input.selfReviewScore,
        // Double-cast: InputSchema uses z.array(z.unknown()) so the bridge can pass issues
        // without re-validating. DB column uses its own SelfReviewIssue type which differs
        // structurally from Zod's inferred type under exactOptionalPropertyTypes (suggestion?: string).
        selfReviewIssues: input.selfReviewIssues as unknown as SelfReviewIssue[],
        // Spec 23: column is now Array — wrap the Article JSON-LD from AssemblyStep
        schemaJsonLd: [input.schemaJsonLd],
        status: "final_review",
        draftPipelineRunId: ctx.pipelineRunId,
        updatedAt: new Date(),
      })
      .where(eq(articles.id, input.articleId));

    return {
      articleId: input.articleId,
      wordCount: input.wordCount,
      selfReviewScore: input.selfReviewScore,
    };
  }
}
