import { articles, db } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { ArticleOutlineSchemaOutput } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  outline: ArticleOutlineSchemaOutput, // cast: see types.ts for .default([]) variance note
  approvalMode: z.enum(["manual", "auto"]),
});

// Outline is already persisted to DB — no need to re-emit it from this step.
const OutputSchema = z.object({
  articleId: z.string().uuid(),
  nextAction: z.enum(["wait_for_review", "auto_continue"]),
});

export class PersistOutlineStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "persist-outline";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    await db
      .update(articles)
      .set({
        title: input.outline.title,
        slug: input.outline.slug,
        metaDescription: input.outline.metaDescription,
        outline: input.outline,
        status: "outline_review",
        outlinePipelineRunId: ctx.pipelineRunId,
        updatedAt: new Date(),
      })
      .where(eq(articles.id, input.articleId));

    const nextAction: "auto_continue" | "wait_for_review" =
      input.approvalMode === "auto" ? "auto_continue" : "wait_for_review";

    return { articleId: input.articleId, nextAction };
  }
}
