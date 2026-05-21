// Spec 62.4 Step 1: validate the project's goals + planner config.
//
// Re-uses `validateProjectGoals` from packages/planner (62.2). When invalid,
// raises PlanGenerationError so the runner aborts before any DB writes. The
// step is debug-pausable so Marcel can inspect resolvedGoals + config in the
// step-pause UI before deciding to continue.

import { validateProjectGoals } from "@marketing-auto/planner";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import type { PipelineStepResolver } from "@marketing-auto/cost-tracker";
import { PlanGenerationError } from "../errors.ts";

export const validateGoalsInputSchema = z.object({
  projectId: z.string().uuid(),
});
type Input = z.infer<typeof validateGoalsInputSchema>;

export const validateGoalsOutputSchema = z.object({
  goals: z.array(z.unknown()),
  config: z.unknown(),
  estimatedWeeklyFloorEur: z.number().nullable(),
  warnings: z.array(
    z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
  ),
});
type Output = z.infer<typeof validateGoalsOutputSchema>;

export class ValidateGoalsStep extends BaseStep<Input, Output> {
  readonly name = "validate-goals";
  readonly inputSchema = validateGoalsInputSchema;
  readonly outputSchema = validateGoalsOutputSchema;
  readonly resolvePipelineSteps?: PipelineStepResolver;

  constructor(resolvePipelineSteps?: PipelineStepResolver) {
    super();
    if (resolvePipelineSteps !== undefined) {
      this.resolvePipelineSteps = resolvePipelineSteps;
    }
  }

  async execute(input: Input, _ctx: StepContext): Promise<Output> {
    const opts: Parameters<typeof validateProjectGoals>[1] =
      this.resolvePipelineSteps !== undefined
        ? { resolvePipelineSteps: this.resolvePipelineSteps }
        : {};
    const result = await validateProjectGoals(input.projectId, opts);
    if (!result.valid) {
      throw new PlanGenerationError("project goals invalid", result.errors);
    }
    if (!result.config) {
      throw new PlanGenerationError("planner config missing", [
        { code: "NO_PLANNER_CONFIG", message: "project_planner_config row not set" },
      ]);
    }
    return {
      goals: result.resolvedGoals,
      config: result.config,
      estimatedWeeklyFloorEur: result.estimatedWeeklyFloorEur,
      warnings: result.warnings,
    };
  }
}
