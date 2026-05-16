import { db, eq, topicBriefs } from "@marketing-auto/db";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { updateArticleAuthor } from "../blog/persist.ts";
import { pickAuthor } from "./index.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  briefId: z.string().uuid(),
});

const OutputSchema = z.object({
  authorSlug: z.string(),
  authorName: z.string(),
  matchStrategy: z.enum(["historic_score", "embedding_fallback", "default_fallback"]),
  matchScore: z.number(),
  warnings: z.array(z.string()),
});

/**
 * Pipeline step: pick the best author for a blog article and write it to the
 * articles row. Wraps pickAuthor() with the BaseStep contract.
 * Cost: €0 (historic) or ~€0.0001 (embedding fallback).
 */
export class AuthorPickStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "author-pick";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0.0001; // worst-case embedding fallback
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const [brief] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, input.briefId))
      .limit(1);

    if (!brief) {
      throw new Error(`TopicBrief ${input.briefId} not found`);
    }

    const warnings: string[] = [];

    if (brief.intentType === "comparison") {
      warnings.push(
        "comparison intent passed through blog generator; consider 54.9b for proper comparisons-collection routing",
      );
      ctx.log.warn({ briefId: brief.id }, "comparison-intent brief in blog generator");
    }

    const result = await pickAuthor(input.projectId, brief, ctx.pipelineRunId);

    await updateArticleAuthor(input.articleId, result.authorSlug, result.matchStrategy);

    ctx.log.info(
      {
        articleId: input.articleId,
        authorSlug: result.authorSlug,
        matchStrategy: result.matchStrategy,
        matchScore: result.matchScore,
        briefSource: brief.source,
        briefIntentType: brief.intentType,
      },
      "[author-pick] author assigned"
    );

    return {
      authorSlug: result.authorSlug,
      authorName: result.authorName,
      matchStrategy: result.matchStrategy,
      matchScore: result.matchScore,
      warnings,
    };
  }
}
