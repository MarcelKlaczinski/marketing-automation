import type { StepContext } from "./step.ts";

/**
 * Spec 62.0a Section 4.4: resolve the prompt for an LLM step, honouring an
 * `edit-prompt` resume override when present.
 *
 * Pattern usage inside an LLM step's `execute()`:
 *
 * ```ts
 * const prompt = resolvePrompt(ctx, this.name, () => buildSystemPrompt({ ... }));
 * ```
 *
 * The default builder is called only when no override is set. This is the canonical
 * entry point for the systemwide LLM-step refactor in Phase 4.
 */
export function resolvePrompt(
  ctx: StepContext,
  stepName: string,
  buildDefault: () => string
): string {
  return ctx.promptOverride?.[stepName] ?? buildDefault();
}
