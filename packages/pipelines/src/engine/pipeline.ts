import { z } from "zod";
import type { BaseStep } from "./step.ts";

/**
 * A pipeline is an ordered list of steps where each step's output flows
 * into the next step's input via a `bridge` function.
 *
 * Pipeline-level input is fed into the first step. Each step's output becomes
 * the next step's input directly (or via a bridge override).
 *
 * To create a new pipeline:
 *   1. Subclass Pipeline
 *   2. Define `name`, `inputSchema`, `outputSchema`
 *   3. Define `steps` array
 *   4. (Optional) Override `bridge` if outputs don't directly map to next input
 */
export abstract class Pipeline<TInput = unknown, TOutput = unknown> {
  abstract readonly name: string;
  abstract readonly inputSchema: z.ZodType<TInput>;
  abstract readonly outputSchema: z.ZodType<TOutput>;

  /** Ordered list of steps. The output of step N feeds step N+1 (via `bridge`). */
  abstract readonly steps: ReadonlyArray<BaseStep<unknown, unknown>>;

  /**
   * Maps the output of one step to the input of the next.
   * Default: identity (output of N is input of N+1, types must match).
   *
   * Override if you need to construct the next step's input from a combination
   * of pipeline input + earlier step outputs.
   */
  bridge(
    _fromStep: BaseStep<unknown, unknown>,
    _toStep: BaseStep<unknown, unknown>,
    output: unknown,
    _pipelineInput: TInput,
    _getStepOutput: <T = unknown>(stepName: string) => T | undefined,
  ): unknown {
    return output;
  }
}
