// Spec 62.0a Section 8.2: 3-step TestPipeline used by integration tests for the
// step-pause + idempotency + prompt-override mechanics.
//
// Step A — pure transform with idempotencyKey
// Step B — "LLM step" that reads ctx.promptOverride (no real LLM call — we want the
//          test to be deterministic + free of network/API key dependencies)
// Step C — pure transform with idempotencyKey based on prev step's output
//
// All steps are pausable in debug mode. The pipeline registers itself in
// `pipelineRegistry` so the BullMQ worker can dispatch it if integration tests
// ever exercise that path; current integration tests call `runPipeline` directly.

import { z } from "zod";
import { BaseStep, Pipeline } from "../../src/engine/index.ts";
import type { StepContext } from "../../src/engine/index.ts";

// ─── Step A ──────────────────────────────────────────────────────────────────

const StepAInputSchema = z.object({ x: z.number() });
const StepAOutputSchema = z.object({ value: z.number() });

export class TestStepA extends BaseStep<
  z.infer<typeof StepAInputSchema>,
  z.infer<typeof StepAOutputSchema>
> {
  readonly name = "step-a";
  readonly inputSchema = StepAInputSchema;
  readonly outputSchema = StepAOutputSchema;

  override idempotencyKey(input: z.infer<typeof StepAInputSchema>): string {
    return `x:${input.x}`;
  }

  async execute(input: z.infer<typeof StepAInputSchema>, _ctx: StepContext) {
    return { value: input.x * 2 };
  }
}

// ─── Step B ──────────────────────────────────────────────────────────────────

const StepBInputSchema = z.object({ value: z.number() });
const StepBOutputSchema = z.object({ doubled: z.number(), llm: z.string() });

/**
 * Pseudo-LLM step. Reads ctx.promptOverride[this.name] directly and writes it into
 * the output. No idempotency key (LLM steps are typically too varied to cache).
 * Lets integration tests assert that edit-prompt resume actions propagate correctly
 * without needing to mock an actual LLM.
 */
export class TestStepB extends BaseStep<
  z.infer<typeof StepBInputSchema>,
  z.infer<typeof StepBOutputSchema>
> {
  readonly name = "step-b";
  readonly inputSchema = StepBInputSchema;
  readonly outputSchema = StepBOutputSchema;

  async execute(input: z.infer<typeof StepBInputSchema>, ctx: StepContext) {
    const promptUsed = ctx.promptOverride?.[this.name] ?? "default-prompt";
    return { doubled: input.value, llm: promptUsed };
  }
}

// ─── Step C ──────────────────────────────────────────────────────────────────

const StepCInputSchema = z.object({ doubled: z.number(), llm: z.string() });
const StepCOutputSchema = z.object({ final: z.number(), llm: z.string() });

export class TestStepC extends BaseStep<
  z.infer<typeof StepCInputSchema>,
  z.infer<typeof StepCOutputSchema>
> {
  readonly name = "step-c";
  readonly inputSchema = StepCInputSchema;
  readonly outputSchema = StepCOutputSchema;

  override idempotencyKey(input: z.infer<typeof StepCInputSchema>): string {
    return `doubled:${input.doubled}`;
  }

  async execute(input: z.infer<typeof StepCInputSchema>, _ctx: StepContext) {
    return { final: input.doubled + 1, llm: input.llm };
  }
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

const TestPipelineInputSchema = z.object({ x: z.number() });
const TestPipelineOutputSchema = z.object({ final: z.number(), llm: z.string() });

export class TestPipeline extends Pipeline<
  z.infer<typeof TestPipelineInputSchema>,
  z.infer<typeof TestPipelineOutputSchema>
> {
  readonly name = "test:step-pause";
  readonly inputSchema = TestPipelineInputSchema;
  readonly outputSchema = TestPipelineOutputSchema;
  readonly steps = [new TestStepA(), new TestStepB(), new TestStepC()] as const;
}
