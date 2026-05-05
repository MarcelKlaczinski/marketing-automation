import { z } from "zod";
import { Pipeline } from "../engine/pipeline.ts";
import { TopicIntakeStep } from "./steps/topic-intake.ts";
import { ResearchStep } from "./steps/research.ts";
import { OutlineStep } from "./steps/outline.ts";
import { PersistOutlineStep } from "./steps/persist-outline.ts";
import { continueArticleGeneration } from "./trigger.ts";

// ───── Job 1: Outline Pipeline ────────────────────────────────────────────────

const OutlineInputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  modelOverride: z.string().optional(),
});

// Outline is in DB after PersistOutlineStep — pipeline output only needs nextAction signal.
const OutlineOutputSchema = z.object({
  articleId: z.string().uuid(),
  nextAction: z.enum(["wait_for_review", "auto_continue"]),
});

type TopicIntakeOutput = {
  cornerstoneKeyword: string;
  clusterName: string;
  clusterPillar: string;
  satelliteKeywords: string[];
  projectSlug: string;
  approvalMode: "manual" | "auto";
};

export class ArticleOutlinePipeline extends Pipeline<
  z.infer<typeof OutlineInputSchema>,
  z.infer<typeof OutlineOutputSchema>
> {
  readonly name = "article:outline";
  readonly inputSchema = OutlineInputSchema;
  readonly outputSchema = OutlineOutputSchema;
  readonly steps = [
    new TopicIntakeStep(),
    new ResearchStep(),
    new OutlineStep(),
    new PersistOutlineStep(),
  ] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: z.infer<typeof OutlineInputSchema>,
    getStepOutput: <T = unknown>(stepName: string) => T | undefined,
  ): unknown {
    // topic-intake → research: pass cornerstone keyword, satellites, project slug
    if (fromStep.name === "topic-intake" && toStep.name === "research") {
      const t = output as TopicIntakeOutput;
      return {
        cornerstoneKeyword: t.cornerstoneKeyword,
        satelliteKeywords: t.satelliteKeywords,
        projectSlug: t.projectSlug,
      };
    }

    // research → outline: merge topic-intake output with research result
    if (fromStep.name === "research" && toStep.name === "outline") {
      const t = getStepOutput<TopicIntakeOutput>("topic-intake")!;
      return {
        cornerstoneKeyword: t.cornerstoneKeyword,
        satelliteKeywords: t.satelliteKeywords,
        clusterName: t.clusterName,
        clusterPillar: t.clusterPillar,
        projectSlug: t.projectSlug,
        research: output,
        ...(pipelineInput.modelOverride && { modelOverride: pipelineInput.modelOverride }),
      };
    }

    // outline → persist-outline: pull approvalMode from topic-intake output (already in memory)
    if (fromStep.name === "outline" && toStep.name === "persist-outline") {
      const t = getStepOutput<TopicIntakeOutput>("topic-intake")!;
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        outline: output,
        approvalMode: t.approvalMode,
      };
    }

    return output;
  }

  /**
   * After all steps succeed: if approvalMode = "auto", immediately enqueue the draft pipeline.
   * afterComplete failures are caught by the runner (logs warn, does not re-trigger retries).
   */
  override async afterComplete(
    output: z.infer<typeof OutlineOutputSchema>,
    pipelineInput: z.infer<typeof OutlineInputSchema>,
  ): Promise<void> {
    if (output.nextAction === "auto_continue") {
      const continueInput: Parameters<typeof continueArticleGeneration>[0] = {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
      };
      if (pipelineInput.modelOverride === "claude-opus-4-7" || pipelineInput.modelOverride === "claude-sonnet-4-6") {
        continueInput.modelOverride = pipelineInput.modelOverride;
      }
      await continueArticleGeneration(continueInput);
    }
  }
}
