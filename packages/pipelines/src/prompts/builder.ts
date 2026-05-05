import { loadSkill, loadSkills, loadProjectContext } from "../skills/loader.ts";

export type SystemPromptInput = {
  /** Skill name(s) from packages/skills. Concatenated in order if array. */
  skills: string | string[];
  /** Project ID (UUID) or slug. Context is loaded from DB. */
  projectIdOrSlug: string;
  /** Step-specific instructions. Hard-coded in the step class. */
  stepInstructions: string;
};

export type SystemPromptResult = {
  /** Cacheable prefix: skill content + project context. Stable across many calls. */
  cacheablePrefix: string;
  /** Variable suffix: step instructions. Changes per step type. */
  variableSuffix: string;
  /** Convenience: full prompt concatenated, for non-cached use. */
  full: string;
};

/**
 * Builds the three-layer system prompt for a generative pipeline step.
 * Returns prefix and suffix separately so callers can apply Anthropic's
 * prompt caching (cache_control: ephemeral) to the prefix only.
 */
export async function buildSystemPrompt(input: SystemPromptInput): Promise<SystemPromptResult> {
  const skillContent = Array.isArray(input.skills)
    ? await loadSkills(input.skills)
    : await loadSkill(input.skills);

  const projectContext = await loadProjectContext(input.projectIdOrSlug);
  if (!projectContext) {
    throw new Error(
      `No marketing context found for project "${input.projectIdOrSlug}". ` +
      `Run sync-context for this project first.`,
    );
  }

  const cacheablePrefix = [
    "# Marketing Skill Reference",
    skillContent,
    "",
    "---",
    "",
    "# Project Marketing Context",
    projectContext,
  ].join("\n");

  const variableSuffix = [
    "---",
    "",
    "# Task-Specific Instructions",
    input.stepInstructions,
  ].join("\n");

  return {
    cacheablePrefix,
    variableSuffix,
    full: `${cacheablePrefix}\n\n${variableSuffix}`,
  };
}
