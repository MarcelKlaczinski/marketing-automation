import type { HookPattern } from "./hookEngine.ts";
import { buildHashtagInstructions, type ContentType } from "../social-hashtags/buildHashtagInstructions.ts";

interface HookPromptContext {
  articleTitle: string;
  toolNames: string[];
  primaryKeyword: string;
}

export interface ContentPromptContext {
  articleTitle: string;
  toolNames: string[];
  primaryKeyword: string;
  locale: "de" | "en";
  articleSlug: string;
  contentType: "comparison" | "tool-spotlight" | "use-case" | "news" | "concept";
  /** Project website domain for the caption CTA link. Defaults to "toolwiki.ai". */
  domain?: string;
  /**
   * Specific tool category derived from article frontmatter (e.g. "KI-Code-Editor", "Bildgenerator").
   * Injected into the hook prompt so the LLM generates domain-specific hooks
   * instead of the generic fallback "KI-Tools".
   */
  toolCategory?: string;
}

/**
 * Spec multi-domain-evolution S4.4: per-niche hook-prompt builder. The niche
 * label ("AI tools niche" for Toolwiki, "balcony-solar niche" for BK, etc.)
 * is injected by the caller via `nicheLabel` — templates stay identical so
 * a per-tenant override is a single string swap. Callers pass
 * `tenantVars.socialHookNiche` from `loadTenantPromptVars(projectId)`.
 *
 * The function shape mirrors the legacy `HOOK_SYSTEM_PROMPTS` constant; this
 * is the only behavioural change required at this site to support
 * per-tenant hooks. Deeper localizations (German vs English examples,
 * niche-specific BAD-hook examples, INFERENCE RULE entries) stay as
 * Toolwiki defaults — non-Toolwiki tenants override the full prompt via
 * `project_configurations.masterPrompts` if/when needed.
 */
function buildHookSystemPrompts(nicheLabel: string): Record<HookPattern, string> {
  return {
  superlative_question: `You are an Instagram hook specialist for the ${nicheLabel}.

PATTERN: superlative_question
Format: "Which [specific subject] is the [highlight] [object]?"

CRITICAL: Use the SPECIFIC tool category in the hook subject, NEVER a generic word like "tools", "KI-Tools", or "KI".

INFERENCE RULE: If toolCategory in the input is "(infer from tool names)", you MUST derive the specific domain from the tool names:
- Cursor + Windsurf + Codeium → "KI-Code-Editor" / "AI code editor"
- Midjourney + DALL-E + Ideogram → "Bildgenerator" / "image generator"
- ChatGPT + Claude + Gemini → "KI-Assistent" / "AI assistant"
- Jasper + Copy.ai → "KI-Texter" / "AI writing tool"

Examples of GOOD hooks (domain-specific):
- "Which AI code editor" + "really wins?" → lead: "Which AI code editor", highlight: "really wins?"
- "Which image generator" + "beats the rest?" → lead: "Which image generator", highlight: "beats the rest?"
- "Welcher KI-Code-Editor" + "gewinnt wirklich?" → lead: "Welcher KI-Code-Editor", highlight: "gewinnt wirklich?"

Examples of BAD hooks (too generic — NEVER do this):
- "Which KI-Tool is the best?" ← "KI-Tool" is not the specific category
- "Welche KI macht die besten KI-Tools?" ← nonsensical — tools don't make tools
- "Welches AI-Tool" + "gewinnt?" ← still too generic

The subject MUST be the SPECIFIC product category. Always infer it from the tool names if not provided.

CONSTRAINTS:
- fullText (lead + highlight + trail) max 7 words total, min 3
- highlightWord is 1-2 words, NEVER more
- No marketing clichés: "innovative", "revolutionary", "groundbreaking", "unique", "ultimate"
- No emojis in hook
- MUST be question format (ends with ?)
- leadPhrase MUST start with capital letter
- For German output: du-form, not Sie

RETURN ONLY JSON: { "leadPhrase": "...", "highlightWord": "...", "trailPhrase": "..." }`,

  number_promise: `You are an Instagram hook specialist for the ${nicheLabel}.

PATTERN: number_promise
Format: "[N] [subjects] [highlight] [result]"
Examples:
- "5 AI tools" + "that replace" + "your entire stack." → fullText: "5 AI tools that replace your entire stack."
- "4 apps" + "I use" + "every single day." → fullText: "4 apps I use every single day."

CONSTRAINTS:
- fullText max 7 words total, min 3
- highlightWord is 1-2 words, NEVER more
- leadPhrase starts with the number (e.g. "5 AI tools")
- No marketing clichés: "innovative", "revolutionary", "groundbreaking", "unique", "ultimate"
- No emojis
- leadPhrase MUST start with capital letter

RETURN ONLY JSON: { "leadPhrase": "...", "highlightWord": "...", "trailPhrase": "..." }`,

  negative_frame: `You are an Instagram hook specialist for the ${nicheLabel}.

PATTERN: negative_frame
Format: "Stop [doing problem]." OR "Not [wrong thing] — [better alternative]."
Examples:
- "Stop using" + "ChatGPT for" + "logo design." → fullText: "Stop using ChatGPT for logo design."
- "Not this AI" + "— there's" + "something better." → fullText: "Not this AI — there's something better."

CONSTRAINTS:
- fullText max 7 words total, min 3
- highlightWord is 1-2 words, NEVER more
- leadPhrase MUST start with negation: "Stop", "Not", "Never", "Avoid"
- No marketing clichés
- No emojis
- leadPhrase MUST start with capital letter

RETURN ONLY JSON: { "leadPhrase": "...", "highlightWord": "...", "trailPhrase": "..." }`,

  identity_frame: `You are an Instagram hook specialist for the ${nicheLabel}.

PATTERN: identity_frame
Format: "You [activity]? [This/These] [tool/tools] you need to know."
Examples:
- "You design logos?" + "These 2" + "tools you need."
- "You use AI daily?" + "These tools" + "you don't know yet."

CONSTRAINTS:
- fullText max 7 words total, min 3
- highlightWord is 1-2 words, NEVER more
- leadPhrase starts with "You" or similar direct address
- No marketing clichés
- No emojis
- leadPhrase MUST start with capital letter
- For German output: Du-form, not Sie

RETURN ONLY JSON: { "leadPhrase": "...", "highlightWord": "...", "trailPhrase": "..." }`,

  curiosity_gap: `You are an Instagram hook specialist for the ${nicheLabel}.

PATTERN: curiosity_gap
Format: "Nobody talks about [topic]." OR "Most people miss [thing] about [topic]."
Examples:
- "Nobody talks" + "about this AI" + "for typography."
- "Most people miss" + "this one" + "AI feature."

CONSTRAINTS:
- fullText max 7 words total, min 3
- highlightWord is 1-2 words, NEVER more
- Creates curiosity without hype
- No marketing clichés
- No emojis
- leadPhrase MUST start with capital letter

RETURN ONLY JSON: { "leadPhrase": "...", "highlightWord": "...", "trailPhrase": "..." }`,
  };
}

function mapContentType(ct: ContentPromptContext["contentType"]): ContentType {
  if (ct === "comparison" || ct === "use-case") return "comparison";
  if (ct === "tool-spotlight") return "review";
  return "general";
}

function buildCaptionSection(ctx: ContentPromptContext): string {
  const domain = ctx.domain ?? "toolwiki.ai";
  const isComparison = ctx.contentType === "comparison" || ctx.contentType === "use-case";
  const locale = ctx.locale === "de" ? "de-DE" : "en-US";

  const hashtagSection = buildHashtagInstructions({
    locale,
    contentType: mapContentType(ctx.contentType),
    toolNames: ctx.toolNames,
    ...(ctx.toolCategory !== undefined && { toolCategory: ctx.toolCategory }),
  });

  if (ctx.locale === "de") {
    return `
CAPTION (German output, du-form):
- Line 1: strongest insight from the article — keyword-rich (Instagram indexes this line for search)
- Lines 2-3: 2-3 sentences of genuine finding. Real insight, not marketing speak.
${isComparison ? "- Name a clear use-case winner — not just 'it depends'" : "- Name the #1 concrete benefit and the #1 concrete limitation of the tool"}
- CTA: "Speicher diesen Post" or "Tag jemanden, der [X] nutzt" — NO comment-baiting ("Schreib in die Kommentare")
- Last line: → ${domain}/${ctx.articleSlug}
- Max 280 chars per paragraph, 4 paragraphs max

${hashtagSection}`;
  }

  return `
CAPTION (English output):
- Line 1: strongest insight from the article — keyword-rich (Instagram indexes this line for search)
- Lines 2-3: 2-3 sentences of genuine finding. Real insight, not marketing speak.
${isComparison ? "- Name a clear use-case winner — not just 'it depends'" : "- Name the #1 concrete benefit and the #1 concrete limitation of the tool"}
- CTA: "Save this post" or "Tag someone who uses [X]" — NO comment-baiting ("Write in the comments")
- Last line: → ${domain}/${ctx.articleSlug}
- Max 280 chars per paragraph, 4 paragraphs max

${hashtagSection}`;
}

export function buildHookPrompt(
  pattern: HookPattern,
  ctx: HookPromptContext,
  /**
   * Spec multi-domain-evolution S4.4: tenant niche label, e.g. "AI tools niche"
   * for Toolwiki. Default keeps the legacy hardcoded Toolwiki string for any
   * caller that doesn't yet thread tenantVars (test fixtures, future callers
   * during the migration window). Production call sites in
   * packages/pipelines/src/article/social-image/steps.ts pass the resolved
   * value from `loadTenantPromptVars(projectId)`.
   */
  nicheLabel: string = "AI tools niche",
  previousViolations?: string[],
): { systemPrompt: string; userPrompt: string } {
  const violationNote = previousViolations?.length
    ? `\n\nPREVIOUS ATTEMPT WAS INVALID:\n${previousViolations.map((v) => `- ${v}`).join("\n")}\nPlease strictly follow the CONSTRAINTS.`
    : "";

  const templates = buildHookSystemPrompts(nicheLabel);

  return {
    systemPrompt: templates[pattern] + violationNote,
    userPrompt: `INPUT:
- Article title: ${ctx.articleTitle}
- Tools: ${ctx.toolNames.join(", ")}
- Target keyword: ${ctx.primaryKeyword}

RETURN ONLY JSON: { "leadPhrase": "...", "highlightWord": "...", "trailPhrase": "..." }`,
  };
}

export function buildContentPrompt(
  pattern: HookPattern,
  ctx: ContentPromptContext,
  previousViolations?: string[],
  /**
   * Spec multi-domain-evolution S4.4: tenant niche label. Default keeps
   * back-compat — callers in template definitions pass tenantVars.socialHookNiche
   * when they wire up Sprint-5 Domain-Registry. For now defaults to the
   * Toolwiki string "AI tools niche".
   */
  nicheLabel: string = "AI tools niche",
): { systemPrompt: string; userPrompt: string } {
  const violationNote = previousViolations?.length
    ? `\n\nPREVIOUS ATTEMPT WAS INVALID:\n${previousViolations.map((v) => `- ${v}`).join("\n")}\nPlease strictly follow all CONSTRAINTS.`
    : "";

  const templates = buildHookSystemPrompts(nicheLabel);
  const systemPrompt =
    templates[pattern] +
    "\n\n---\n" +
    buildCaptionSection(ctx) +
    "\n\nRETURN ONLY JSON with all fields:\n" +
    '{ "leadPhrase": "...", "highlightWord": "...", "trailPhrase": "...", "caption": "...", "hashtags": ["...", ...] }' +
    violationNote;

  return {
    systemPrompt,
    userPrompt: `INPUT:
- Article title: ${ctx.articleTitle}
- Tools: ${ctx.toolNames.join(", ")}
- Tool category: ${ctx.toolCategory ?? "(infer from tool names)"}
- Content type: ${ctx.contentType}
- Target keyword: ${ctx.primaryKeyword}
- Article slug: ${ctx.articleSlug}
- Output locale: ${ctx.locale}

RETURN ONLY JSON: { "leadPhrase": "...", "highlightWord": "...", "trailPhrase": "...", "caption": "...", "hashtags": ["...", ...] }`,
  };
}
