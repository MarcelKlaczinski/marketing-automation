import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import { GenerateVoiceQuestionsStep, SynthesizeVoiceContextStep } from "./steps.ts";

// ─── Questions pipeline ───────────────────────────────────────────────────────

const QuestionsInputSchema = z.object({
  projectSlug: z.string(),
  existingContextMd: z.string(),
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
}
