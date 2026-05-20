import type { StepContext } from "./step.ts";
import { getGoldenPromptCached } from "./golden-prompt-cache.ts";

/**
 * Spec 62.0b Section 4.1: resolve the prompt for an LLM step using the hybrid lookup chain.
 *
 * Priority order:
 *   1. `ctx.promptOverride[stepName]` — Debug-Run override from `edit-prompt` resume (highest).
 *   2. Project-specific golden in `prompt_versions` (cached, 5-min TTL).
 *   3. Global golden in `prompt_versions` (cached, 5-min TTL).
 *   4. `buildDefault()` — the file-level default the step ships with.
 *
 * This function is async since 62.0b — callers must `await`. Every call site lives inside
 * an existing `async execute()` so adding `await` is a one-line mechanical change.
 *
 * Pattern usage inside an LLM step's `execute()`:
 *
 * ```ts
 * const prompt = resolvePrompt(ctx, this.name, () => buildSystemPrompt({ ... }));
 * ```
 *
 * Scope: same as 62.0a — wraps the **`systemSuffix`** (variable step instructions) only.
 * The `cacheablePrefix` / `systemPrefix` (skill foundation + project context) is NOT
 * affected, so Anthropic prompt-cache hits keep working through debug runs and promoted
 * goldens preserve the project's marketing context.
 */
export async function resolvePrompt(
  ctx: StepContext,
  stepName: string,
  buildDefault: () => string
): Promise<string> {
  // Tier 1: Debug-Run override (62.0a).
  // Match `??` semantics — an explicit empty-string is a valid override (e.g. "use no
  // system suffix at all"), only `undefined` falls through to the next tier.
  const override = ctx.promptOverride?.[stepName];
  if (override !== undefined) return override;

  // Tier 2: project-specific golden
  const projectGolden = await getGoldenPromptCached({
    stepName,
    projectId: ctx.projectId,
  });
  if (projectGolden) return projectGolden.body;

  // Tier 3: global golden
  const globalGolden = await getGoldenPromptCached({
    stepName,
    projectId: null,
  });
  if (globalGolden) return globalGolden.body;

  // Tier 4: file default
  return buildDefault();
}
