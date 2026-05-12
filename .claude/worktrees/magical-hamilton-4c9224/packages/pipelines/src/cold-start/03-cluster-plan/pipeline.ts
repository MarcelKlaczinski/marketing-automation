import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import {
  type ClusterCandidateSchema,
  ConfirmedClusterSchema,
  ExpandWithSatellitesStep,
  type ExpandedClusterSchema,
  FinalClusterSchema,
  GenerateClusterCandidatesStep,
  SatelliteKeywordSchema,
  SynthesizeClusterPlanStep,
  ValidateKeywordsStep,
  ValidatedClusterSchema,
} from "./steps.ts";

// ─── Propose pipeline ─────────────────────────────────────────────────────────
// Runs GenerateClusterCandidatesStep + ValidateKeywordsStep.
// Output: validated candidate list with search volumes — Marcel reviews and edits before expand.

const ProposeInputSchema = z.object({
  projectSlug: z.string(),
  contentGaps: z.array(z.string()),
  topicsToAvoid: z.array(z.string()),
});

const ProposeOutputSchema = z.object({
  validated: z.array(ValidatedClusterSchema),
  filteredCount: z.number(),
});

export class ClusterProposePipeline extends Pipeline<
  z.infer<typeof ProposeInputSchema>,
  z.infer<typeof ProposeOutputSchema>
> {
  readonly name = "cold-start:cluster-propose";
  readonly inputSchema = ProposeInputSchema;
  readonly outputSchema = ProposeOutputSchema;
  readonly steps = [new GenerateClusterCandidatesStep(), new ValidateKeywordsStep()] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    _pipelineInput: z.infer<typeof ProposeInputSchema>,
    _getStepOutput: <T = unknown>(stepName: string) => T | undefined
  ): unknown {
    if (
      fromStep.name === "generate-cluster-candidates" &&
      toStep.name === "validate-cluster-keywords"
    ) {
      const out = output as { candidates: Array<z.infer<typeof ClusterCandidateSchema>> };
      return { candidates: out.candidates };
    }
    return output;
  }
}

// ─── Expand pipeline ──────────────────────────────────────────────────────────
// Reads Marcel's confirmed cluster list, expands with DataForSEO satellites,
// then synthesizes the final cluster plan markdown.

const ExpandInputSchema = z.object({
  projectSlug: z.string(),
  confirmedClusters: z.array(ConfirmedClusterSchema).min(1),
  contentGaps: z.array(z.string()),
  topicsToAvoid: z.array(z.string()),
});

const ExpandOutputSchema = z.object({
  reportMd: z.string(),
  clusters: z.array(FinalClusterSchema),
});

export class ClusterExpandPipeline extends Pipeline<
  z.infer<typeof ExpandInputSchema>,
  z.infer<typeof ExpandOutputSchema>
> {
  readonly name = "cold-start:cluster-expand";
  readonly inputSchema = ExpandInputSchema;
  readonly outputSchema = ExpandOutputSchema;
  readonly steps = [new ExpandWithSatellitesStep(), new SynthesizeClusterPlanStep()] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: z.infer<typeof ExpandInputSchema>,
    _getStepOutput: <T = unknown>(stepName: string) => T | undefined
  ): unknown {
    if (fromStep.name === "expand-with-satellites" && toStep.name === "synthesize-cluster-plan") {
      const out = output as { expandedClusters: Array<z.infer<typeof ExpandedClusterSchema>> };
      return {
        projectSlug: pipelineInput.projectSlug,
        expandedClusters: out.expandedClusters,
        contentGaps: pipelineInput.contentGaps,
        topicsToAvoid: pipelineInput.topicsToAvoid,
      };
    }
    return output;
  }
}

// Re-export schemas needed by the CLI script
export {
  ConfirmedClusterSchema,
  ValidatedClusterSchema,
  FinalClusterSchema,
  SatelliteKeywordSchema,
};
