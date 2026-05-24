import type { FrontmatterFieldDescriptor } from "@marketing-auto/db";
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
  /**
   * Spec 50: Frontmatter schema for the target Astro collection (e.g. "blog").
   * When provided, injects a "Frontmatter Requirements" block into the cacheable
   * prefix so LLM-generated content includes all required structured fields.
   */
  frontmatterSchema?: FrontmatterFieldDescriptor[];
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

  const frontmatterBlock = input.frontmatterSchema
    ? buildFrontmatterBlock(input.frontmatterSchema)
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
    frontmatterBlock,
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

/**
 * Spec 50: Builds a human-readable "Frontmatter Requirements" block for injection
 * into the system prompt. Tells the LLM which structured fields must appear in
 * the DOMAIN_EXTRAS block at the end of its output.
 */
function buildFrontmatterBlock(fields: FrontmatterFieldDescriptor[]): string {
  if (!fields.length) return "";

  const required = fields.filter((f) => f.required);
  const structured = fields.filter(
    (f) => !f.required && (f.enumValues?.length || f.type === "object_array" || f.type === "string_array")
  );

  const lines: string[] = [
    "",
    "---",
    "",
    "# Frontmatter Requirements (Astro Content Collection)",
    "",
    "At the end of your response, output a DOMAIN_EXTRAS block with structured metadata.",
    "Format: `<!-- DOMAIN_EXTRAS: {...JSON...} -->`",
    "The JSON must satisfy this schema:",
    "",
  ];

  if (required.length) {
    lines.push("## Required fields");
    for (const f of required) {
      const typePart = f.enumValues?.length
        ? `enum: ${f.enumValues.map((v) => `"${v}"`).join(" | ")}`
        : f.objectShape
          ? `${f.type} of ${f.objectShape}`
          : f.type;
      lines.push(`- \`${f.name}\` (${typePart})`);
    }
    lines.push("");
  }

  if (structured.length) {
    lines.push("## Recommended structured fields (include when content warrants it)");
    for (const f of structured) {
      const typePart = f.enumValues?.length
        ? `enum: ${f.enumValues.map((v) => `"${v}"`).join(" | ")}`
        : f.objectShape
          ? `${f.type} of ${f.objectShape}`
          : f.type;
      lines.push(`- \`${f.name}\` (${typePart})`);
    }
    lines.push("");
  }

  lines.push(
    "Example output (at the very end, after the article body):",
    "```",
    "<!-- DOMAIN_EXTRAS: {\"category\":\"Guides & Tutorials\",\"intentType\":\"tutorial\",\"tags\":[\"ki\",\"chatbots\"],\"faq\":[{\"question\":\"...\",\"answer\":\"...\"}]} -->",
    "```",
  );

  return lines.join("\n");
}
