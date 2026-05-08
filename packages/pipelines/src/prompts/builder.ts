import { loadProjectContext, loadSkill, loadSkills } from "../skills/loader.ts";

export type SystemPromptInput = {
  /** Skill name(s) from packages/skills. Concatenated in order if array. */
  skills: string | string[];
  /** Project ID (UUID) or slug. Context is loaded from DB. */
  projectIdOrSlug: string;
  /** Step-specific instructions. Hard-coded in the step class. */
  stepInstructions: string;
  /**
   * Target locale for this generation. When set, injects a market-context block
   * into the cacheable prefix instructing the LLM to write for that market.
   * Omit for locale-neutral steps (research synthesis, schema markup, etc.).
   */
  locale?: "de" | "en";
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
      `No marketing context found for project "${input.projectIdOrSlug}". Run sync-context for this project first.`
    );
  }

  const localeBlock =
    input.locale === "de"
      ? "\n\n---\n\n# Market Context\n\nThis output is for the **German market (de-DE)**. Write in German. Use German SEO conventions (compound nouns, longer search phrases). Apply German cultural references and business norms (DSGVO, UWG). Convert umlauts to ae/oe/ue/ss in URL slugs."
      : input.locale === "en"
        ? "\n\n---\n\n# Market Context\n\nThis output is for the **global English market (en-US)**. Write in clear, direct English. Use US/global cultural and business context. Avoid German-specific references."
        : "";

  const cacheablePrefix = [
    "# Marketing Skill Reference",
    skillContent,
    "",
    "---",
    "",
    "# Project Marketing Context",
    projectContext,
    localeBlock,
  ].join("\n");

  const variableSuffix = ["---", "", "# Task-Specific Instructions", input.stepInstructions].join(
    "\n"
  );

  return {
    cacheablePrefix,
    variableSuffix,
    full: `${cacheablePrefix}\n\n${variableSuffix}`,
  };
}
