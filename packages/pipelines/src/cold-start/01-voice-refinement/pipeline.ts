import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, projects } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { Pipeline } from "../../engine/pipeline.ts";
import { GenerateVoiceQuestionsStep, SynthesizeVoiceContextStep } from "./steps.ts";

const log = createLogger("pipelines:voice-synthesis");

// ─── Questions pipeline ───────────────────────────────────────────────────────

const QuestionsInputSchema = z.object({
  projectSlug: z.string(),
  existingContextMd: z.string(),
  projectId: z.string().optional(),
});

const QuestionsOutputSchema = z.object({
  questions: z.array(z.object({
    id: z.string(),
    category: z.string(),
    question: z.string(),
    why_it_matters: z.string(),
    suggested_starter: z.string(),
  })),
});

export class VoiceRefinementQuestionsPipeline extends Pipeline<
  z.infer<typeof QuestionsInputSchema>,
  z.infer<typeof QuestionsOutputSchema>
> {
  readonly name = "cold-start:voice-refinement-questions";
  readonly inputSchema = QuestionsInputSchema;
  readonly outputSchema = QuestionsOutputSchema;
  readonly steps = [new GenerateVoiceQuestionsStep()] as const;
}

// ─── Synthesis pipeline ───────────────────────────────────────────────────────

const SynthesisInputSchema = z.object({
  projectSlug: z.string(),
  existingContextMd: z.string(),
  answeredQuestionsMd: z.string(),
  projectId: z.string().optional(),
});

const SynthesisOutputSchema = z.object({
  updatedMarketingContextMd: z.string(),
  changesSummary: z.array(z.string()),
});

export class VoiceSynthesisPipeline extends Pipeline<
  z.infer<typeof SynthesisInputSchema>,
  z.infer<typeof SynthesisOutputSchema>
> {
  readonly name = "cold-start:voice-synthesis";
  readonly inputSchema = SynthesisInputSchema;
  readonly outputSchema = SynthesisOutputSchema;
  readonly steps = [new SynthesizeVoiceContextStep()] as const;

  override async afterComplete(
    output: z.infer<typeof SynthesisOutputSchema>,
    input: z.infer<typeof SynthesisInputSchema>,
  ): Promise<void> {
    try {
      const condition = input.projectId
        ? eq(projects.id, input.projectId)
        : eq(projects.slug, input.projectSlug);
      await db.update(projects)
        .set({ marketingContextMd: output.updatedMarketingContextMd, updatedAt: new Date() })
        .where(condition);
      log.info({ projectSlug: input.projectSlug }, "marketingContextMd written to project");
    } catch (err) {
      log.error({ err, projectSlug: input.projectSlug }, "Failed to write marketingContextMd");
      throw err;
    }
  }
}
