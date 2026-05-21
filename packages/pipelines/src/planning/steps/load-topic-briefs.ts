// Spec 62.4 Step 3: load the pending-brief queue for the project. The
// content-type matching happens in SelectFloorItemsStep; this step just
// fetches the raw list.

import { loadPendingTopicBriefs } from "@marketing-auto/planner";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";

export const loadTopicBriefsInputSchema = z.object({
  projectId: z.string().uuid(),
});
type Input = z.infer<typeof loadTopicBriefsInputSchema>;

export const loadTopicBriefsOutputSchema = z.object({
  topicBriefs: z.array(z.unknown()),
});
type Output = z.infer<typeof loadTopicBriefsOutputSchema>;

export class LoadTopicBriefsStep extends BaseStep<Input, Output> {
  readonly name = "load-topic-briefs";
  readonly inputSchema = loadTopicBriefsInputSchema;
  readonly outputSchema = loadTopicBriefsOutputSchema;

  async execute(input: Input, _ctx: StepContext): Promise<Output> {
    const briefs = await loadPendingTopicBriefs({ projectId: input.projectId });
    return { topicBriefs: briefs };
  }
}
