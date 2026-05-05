import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import {
  GenerateCornerstoneSpecsStep,
  ApprovedClusterSchema,
  CornerstoneSpecSchema,
} from "./steps.ts";

const InputSchema = z.object({
  projectSlug: z.string(),
  approvedClusters: z.array(ApprovedClusterSchema).min(1),
});

const OutputSchema = z.object({
  cornerstones: z.array(CornerstoneSpecSchema).min(1),
});

export class CornerstoneListPipeline extends Pipeline<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "cold-start:cornerstone-list";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  readonly steps = [new GenerateCornerstoneSpecsStep()] as const;
}

export { ApprovedClusterSchema, CornerstoneSpecSchema };
