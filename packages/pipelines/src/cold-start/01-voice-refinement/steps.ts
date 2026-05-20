import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { resolvePrompt } from "../../engine/prompt-resolver.ts";

// ─── Step 1: Generate questions ──────────────────────────────────────────────

const VoiceQuestionsOutputSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.coerce.string(), // LLM occasionally returns numeric IDs — coerce to string
        category: z.enum([
          "voice",
          "audience",
          "pillar",
          "tone",
          "differentiation",
          "monetization",
        ]),
        question: z.string(),
        why_it_matters: z.string(),
        suggested_starter: z.string(),
      })
    )
    .min(8)
    .max(15),
});

export type VoiceQuestionsOutput = z.infer<typeof VoiceQuestionsOutputSchema>;

const VoiceQuestionsInputSchema = z.object({
  projectSlug: z.string(),
  existingContextMd: z.string(),
});

export class GenerateVoiceQuestionsStep extends BaseStep<
  z.infer<typeof VoiceQuestionsInputSchema>,
  VoiceQuestionsOutput
> {
  readonly name = "generate-voice-questions";
  readonly inputSchema = VoiceQuestionsInputSchema;
  readonly outputSchema = VoiceQuestionsOutputSchema;

  override estimatedCostEur(_input: z.infer<typeof VoiceQuestionsInputSchema>): number {
    return 0.1;
  }

  async execute(
    input: z.infer<typeof VoiceQuestionsInputSchema>,
    ctx: StepContext
  ): Promise<VoiceQuestionsOutput> {
    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "content-strategy"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
You are helping Marcel refine the brand voice for a content site during cold-start onboarding.

You have access to the existing marketing-context.md (rough draft, partially filled).
Your job: produce 8-15 sharp, specific questions whose answers will let us fully populate the
final marketing-context.md.

Rules:
- Don't ask questions where the existing context already gives a clear answer
- Focus on what's vague, contradictory, or missing
- Each question should be SPECIFIC. Bad: "What's your tone?" Good: "When a reader makes a
  technical mistake in a comment, do you correct them gently, ignore, or call it out
  publicly to make a point?"
- Group questions by category (voice / audience / pillar / tone / differentiation / monetization)
- Each question must have a "why_it_matters" (1 sentence) and a "suggested_starter"
  (a possible answer phrase Marcel can build on or reject)
- Output strict JSON matching: { questions: [{ id, category, question, why_it_matters, suggested_starter }] }
`,
    });

    // Spec 62.0a Section 4.4: edit-prompt resume override replaces variableSuffix.
    const systemSuffix = await resolvePrompt(ctx, this.name, () => prompt.variableSuffix);
    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.COLD_START_VOICE_QUESTIONS,
      model: "claude-sonnet-4-6",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix,
      userMessage: `Here is the current marketing-context.md:\n\n${input.existingContextMd}\n\nProduce the questions.`,
      maxTokens: 4000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(input),
    });

    return VoiceQuestionsOutputSchema.parse(result.json);
  }
}

// ─── Step 2: Synthesize updated marketing-context.md ─────────────────────────

const VoiceSynthesisOutputSchema = z.object({
  updatedMarketingContextMd: z.string().min(500),
  changesSummary: z.array(z.string()).min(1),
});

export type VoiceSynthesisOutput = z.infer<typeof VoiceSynthesisOutputSchema>;

const VoiceSynthesisInputSchema = z.object({
  projectSlug: z.string(),
  existingContextMd: z.string(),
  answeredQuestionsMd: z.string(),
});

export class SynthesizeVoiceContextStep extends BaseStep<
  z.infer<typeof VoiceSynthesisInputSchema>,
  VoiceSynthesisOutput
> {
  readonly name = "synthesize-voice-context";
  readonly inputSchema = VoiceSynthesisInputSchema;
  readonly outputSchema = VoiceSynthesisOutputSchema;

  override estimatedCostEur(_input: z.infer<typeof VoiceSynthesisInputSchema>): number {
    return 0.3;
  }

  async execute(
    input: z.infer<typeof VoiceSynthesisInputSchema>,
    ctx: StepContext
  ): Promise<VoiceSynthesisOutput> {
    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "content-strategy"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: `
Given the original marketing-context.md and Marcel's answers to refinement questions,
produce an UPDATED marketing-context.md that:

1. Preserves the document structure (frontmatter + numbered sections per the existing template)
2. Incorporates Marcel's answers into the relevant sections
3. Tightens prose where Marcel was specific
4. Removes content the answers contradict
5. Keeps Marcel's exact wording where he was emphatic ("never use this phrase" stays verbatim)

Output strict JSON: { updatedMarketingContextMd, changesSummary }
- updatedMarketingContextMd: full file content including frontmatter
- changesSummary: 3-7 bullet points describing what changed
`,
    });

    // Spec 62.0a Section 4.4: edit-prompt resume override replaces variableSuffix.
    const systemSuffix = await resolvePrompt(ctx, this.name, () => prompt.variableSuffix);
    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.COLD_START_VOICE_SYNTHESIS,
      model: "claude-opus-4-7",
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix,
      userMessage: `# Original marketing-context.md\n${input.existingContextMd}\n\n---\n\n# Marcel's answers\n${input.answeredQuestionsMd}\n\nNow produce the updated marketing-context.md.`,
      maxTokens: 8000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(input),
    });

    return VoiceSynthesisOutputSchema.parse(result.json);
  }
}
