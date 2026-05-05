import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import {
  IdentifyCompetitorsStep,
  FetchCompetitorKeywordsStep,
  SynthesizeCompetitorReportStep,
  CompetitorSchema,
} from "./steps.ts";

// ─── Questions pipeline ───────────────────────────────────────────────────────
// Runs IdentifyCompetitorsStep only. Output goes to disk for Marcel to review.

const QuestionsInputSchema = z.object({
  projectSlug: z.string(),
});

const QuestionsOutputSchema = z.object({
  competitors: z.array(CompetitorSchema),
  review_questions: z.array(z.object({
    id: z.string(),
    question: z.string(),
    why_it_matters: z.string(),
  })),
});

export class CompetitorQuestionsPipeline extends Pipeline<
  z.infer<typeof QuestionsInputSchema>,
  z.infer<typeof QuestionsOutputSchema>
> {
  readonly name = "cold-start:competitor-questions";
  readonly inputSchema = QuestionsInputSchema;
  readonly outputSchema = QuestionsOutputSchema;
  readonly steps = [new IdentifyCompetitorsStep()] as const;
}

// ─── Analysis pipeline ────────────────────────────────────────────────────────
// Reads Marcel's confirmed competitor list, runs DataForSEO + synthesis.

const AnalysisInputSchema = z.object({
  projectSlug: z.string(),
  competitors: z.array(CompetitorSchema).min(1).max(5),
});

const AnalysisOutputSchema = z.object({
  reportMd: z.string(),
  contentGaps: z.array(z.string()),
  topicsToAvoid: z.array(z.string()),
});

export class CompetitorAnalysisPipeline extends Pipeline<
  z.infer<typeof AnalysisInputSchema>,
  z.infer<typeof AnalysisOutputSchema>
> {
  readonly name = "cold-start:competitor-analysis";
  readonly inputSchema = AnalysisInputSchema;
  readonly outputSchema = AnalysisOutputSchema;
  readonly steps = [
    new FetchCompetitorKeywordsStep(),
    new SynthesizeCompetitorReportStep(),
  ] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: z.infer<typeof AnalysisInputSchema>,
    _getStepOutput: <T = unknown>(stepName: string) => T | undefined,
  ): unknown {
    if (
      fromStep.name === "fetch-competitor-keywords" &&
      toStep.name === "synthesize-competitor-report"
    ) {
      const fkOutput = output as { competitorData: Array<unknown> };
      return {
        projectSlug: pipelineInput.projectSlug,
        competitors: pipelineInput.competitors,
        competitorData: fkOutput.competitorData,
      };
    }
    return output;
  }
}
