import { z } from "zod";
import { eq } from "drizzle-orm";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { db, articles, schemaExtensionRuns } from "@marketing-auto/db";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  schemaJsonLd: z.array(z.record(z.unknown())),
  detection: z.object({
    hasFaq: z.boolean(),
    hasHowTo: z.boolean(),
    faqQuestions: z.array(z.unknown()),
    howToSteps: z.array(z.unknown()),
  }),
  addedTypes: z.array(z.string()),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  schemaCount: z.number(),
  schemaExtensionRunId: z.string().uuid(),
});

export class PersistSchemaStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "persist-schema";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const now = new Date();

    await db.update(articles).set({
      schemaJsonLd: input.schemaJsonLd,
      status: "final_review",
      updatedAt: now,
    }).where(eq(articles.id, input.articleId));

    const [run] = await db.insert(schemaExtensionRuns).values({
      projectId: input.projectId,
      articleId: input.articleId,
      pipelineRunId: ctx.pipelineRunId ?? null,
      status: "succeeded",
      detectedTypes: {
        breadcrumb: true,
        faq: input.detection.hasFaq,
        howto: input.detection.hasHowTo,
      },
      faqQuestionCount: input.detection.faqQuestions.length,
      howtoStepCount: input.detection.howToSteps.length,
      finishedAt: now,
    }).returning();

    return {
      articleId: input.articleId,
      schemaCount: input.schemaJsonLd.length,
      schemaExtensionRunId: run!.id,
    };
  }
}
