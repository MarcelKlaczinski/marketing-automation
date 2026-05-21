// Spec 62.4: the PlanWeekPipeline composes all 11 planning steps.
//
// Each step reads its inputs via `ctx.getStepOutput(name)` rather than the
// bridge() output chain — that's necessary because most steps need data
// from 2-3 prior steps, not just the immediately preceding one. The
// `bridge()` override therefore returns a thin {projectId, ...} structure
// that matches each step's `inputSchema` and lets the runner pass
// validation. Real data flow happens via `getStepOutput`.

import type { PipelineStepResolver } from "@marketing-auto/cost-tracker";
import { Pipeline } from "../engine/pipeline.ts";
import type { BaseStep } from "../engine/step.ts";
import { ApplySiblingLocaleStep } from "./steps/apply-sibling-locale.ts";
import { BudgetGateStep } from "./steps/budget-gate.ts";
import { DistributeSlotDatesStep } from "./steps/distribute-slot-dates.ts";
import { EstimateCostStep } from "./steps/estimate-cost.ts";
import { LoadTopicBriefsStep } from "./steps/load-topic-briefs.ts";
import { PersistPlanStep } from "./steps/persist-plan.ts";
import { RefreshSignalsStep, type RefreshSignalsDeps } from "./steps/refresh-signals.ts";
import { SelectFloorItemsStep } from "./steps/select-floor-items.ts";
import { SelectOverageItemsStep } from "./steps/select-overage-items.ts";
import { SnapshotInputsStep } from "./steps/snapshot-inputs.ts";
import { ValidateGoalsStep } from "./steps/validate-goals.ts";
import {
  planWeekPipelineInputSchema,
  planWeekPipelineOutputSchema,
  type PlanWeekPipelineInput,
  type PlanWeekPipelineOutput,
} from "./types.ts";

export interface PlanWeekPipelineDeps {
  resolvePipelineSteps?: PipelineStepResolver;
  refreshDeps: RefreshSignalsDeps;
}

export class PlanWeekPipeline extends Pipeline<PlanWeekPipelineInput, PlanWeekPipelineOutput> {
  readonly name = "planning:weekly";
  readonly inputSchema = planWeekPipelineInputSchema;
  readonly outputSchema = planWeekPipelineOutputSchema;
  readonly steps: ReadonlyArray<BaseStep<unknown, unknown>>;

  constructor(deps: PlanWeekPipelineDeps) {
    super();
    const validate = new ValidateGoalsStep(deps.resolvePipelineSteps);
    const refresh = new RefreshSignalsStep(deps.refreshDeps);
    const loadBriefs = new LoadTopicBriefsStep();
    const snapshot = new SnapshotInputsStep();
    const selectFloor = new SelectFloorItemsStep();
    const selectOverage = new SelectOverageItemsStep();
    const applySib = new ApplySiblingLocaleStep();
    const distribute = new DistributeSlotDatesStep();
    const estimate = new EstimateCostStep(deps.resolvePipelineSteps);
    const gate = new BudgetGateStep();
    const persist = new PersistPlanStep();
    // Pipeline base class declares `steps: ReadonlyArray<BaseStep<unknown,
    // unknown>>`; the concrete step classes here are `BaseStep<Specific,
    // Specific>`. TS rejects the assignment because step inputs are
    // contravariant. The cast is the standard escape hatch used by every
    // other Pipeline subclass in this repo (e.g. BlogPipeline) — see the
    // canonical example in packages/pipelines/src/article/blog/pipeline.ts.
    this.steps = [
      validate,
      refresh,
      loadBriefs,
      snapshot,
      selectFloor,
      selectOverage,
      applySib,
      distribute,
      estimate,
      gate,
      persist,
    ] as ReadonlyArray<BaseStep<unknown, unknown>>;
  }

  /**
   * Every step takes the same minimal input shape derived from the pipeline
   * input. Real per-step data is read via `ctx.getStepOutput`. SnapshotInputs
   * additionally needs `topNSignalsAllowedOverage`; DistributeSlotDates and
   * PersistPlan need the target year/week; PersistPlan needs `triggeredBy` +
   * `force`. We construct the right shape per `toStep.name`.
   */
  override bridge(
    _fromStep: BaseStep<unknown, unknown>,
    toStep: BaseStep<unknown, unknown>,
    _output: unknown,
    pipelineInput: PlanWeekPipelineInput,
    getStepOutput: <T = unknown>(stepName: string) => T | undefined,
  ): unknown {
    switch (toStep.name) {
      case "snapshot-inputs": {
        const cfg = getStepOutput<{ config: { topNSignalsAllowedOverage: number } }>(
          "validate-goals",
        )?.config;
        return {
          projectId: pipelineInput.projectId,
          topNSignalsAllowedOverage: cfg?.topNSignalsAllowedOverage ?? 3,
        };
      }
      case "distribute-slot-dates":
        return {
          projectId: pipelineInput.projectId,
          targetYear: pipelineInput.targetYear,
          targetIsoWeek: pipelineInput.targetIsoWeek,
        };
      case "persist-plan":
        return {
          projectId: pipelineInput.projectId,
          targetYear: pipelineInput.targetYear,
          targetIsoWeek: pipelineInput.targetIsoWeek,
          triggeredBy: pipelineInput.triggeredBy,
          force: pipelineInput.force,
        };
      default:
        return { projectId: pipelineInput.projectId };
    }
  }
}
