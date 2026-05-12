import { z } from "zod";
import { Pipeline } from "../../engine/pipeline.ts";
import { GenerateGoLiveChecklistStep, GoLiveChecklistOutputSchema } from "./steps.ts";

const InputSchema = z.object({ projectSlug: z.string() });

export class GoLiveChecklistPipeline extends Pipeline<
  z.infer<typeof InputSchema>,
  z.infer<typeof GoLiveChecklistOutputSchema>
> {
  readonly name = "cold-start:go-live-checklist";
  readonly inputSchema = InputSchema;
  readonly outputSchema = GoLiveChecklistOutputSchema;
  readonly steps = [new GenerateGoLiveChecklistStep()] as const;
}

export { GoLiveChecklistOutputSchema };
export type { GoLiveChecklistOutput } from "./steps.ts";
