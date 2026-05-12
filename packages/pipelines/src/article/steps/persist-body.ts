import { articles, db } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";

// Checkpoint step: persists body_md immediately after DraftStep so the draft
// is never lost if SelfReview, HeroImage, or Assembly fail later.
// PersistArticleStep still runs at the end to set final status + hero + schema.

const InputSchema = z.object({
  articleId: z.string().uuid(),
  bodyMd: z.string(),
  wordCount: z.number(),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  bodyMd: z.string(),
  wordCount: z.number(),
});

export class PersistBodyStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "persist-body";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    await db
      .update(articles)
      .set({
        bodyMd:    input.bodyMd,
        wordCount: input.wordCount,
        updatedAt: new Date(),
      })
      .where(eq(articles.id, input.articleId));

    return {
      articleId: input.articleId,
      bodyMd:    input.bodyMd,
      wordCount: input.wordCount,
    };
  }
}
