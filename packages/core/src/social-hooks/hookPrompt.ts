import type { HookPattern } from "./hookEngine.ts";

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
}

const HOOK_SYSTEM_PROMPTS: Record<HookPattern, string> = {
  superlative_question: `You are an Instagram hook specialist for the AI tools niche.

PATTERN: superlative_question
Format: "Which [subject] is the [highlight] [object]?"
Examples:
- "Which AI creates the best logos?" → lead: "Which AI creates", highlight: "the best", trail: "logos?"
- "Which app saves the most time?" → lead: "Which app saves", highlight: "the most", trail: "time?"

CONSTRAINTS:
- fullText (lead + highlight + trail) max 7 words total, min 3
- highlightWord is 1-2 words, NEVER more
- No marketing clichés: "innovative", "revolutionary", "groundbreaking", "unique", "ultimate"
- No emojis in hook
- MUST be question format (ends with ?)
- leadPhrase MUST start with capital letter
- For German output: du-form, not Sie

RETURN ONLY JSON: { "leadPhrase": "...", "highlightWord": "...", "trailPhrase": "..." }`,

  number_promise: `You are an Instagram hook specialist for the AI tools niche.

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

  negative_frame: `You are an Instagram hook specialist for the AI tools niche.

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

  identity_frame: `You are an Instagram hook specialist for the AI tools niche.

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

  curiosity_gap: `You are an Instagram hook specialist for the AI tools niche.

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

function buildCaptionSection(ctx: ContentPromptContext): string {
  const isComparison = ctx.contentType === "comparison" || ctx.contentType === "use-case";
  const domain = "toolwiki.ai";

  if (ctx.locale === "de") {
    const hashtagRule = isComparison
      ? `- German: #KITools, #KIVergleich, #KIFürBusiness + 1 niche German tag (e.g. #SoftwareTest)
- English: #AITools, #AIComparison, #AIForBusiness + 1 niche English tag (e.g. #SoftwareReview)
- Total: exactly 7 tags`
      : `- German: #KITools, #KIFürBusiness, #Produktivität + 1 niche German tag based on tool category
- English: #AITools, #AIForBusiness, #DigitalTools + 1 niche English tag based on tool category
- Total: exactly 7 tags`;

    return `
CAPTION (German output, du-form):
- Line 1: strongest insight from the article — keyword-rich (Instagram indexes this line for search)
- Lines 2-3: 2-3 sentences of genuine finding. Real insight, not marketing speak.
${isComparison ? "- Name a clear use-case winner — not just 'it depends'" : "- Name the #1 concrete benefit and the #1 concrete limitation of the tool"}
- CTA: "Speicher diesen Post" or "Tag jemanden, der [X] nutzt" — NO comment-baiting ("Schreib in die Kommentare")
- Last line: → ${domain}/${ctx.articleSlug}
- Max 280 chars per paragraph, 4 paragraphs max

HASHTAGS (7 tags, bilingual for dual search intent on Instagram):
${hashtagRule}
- NO self-promotional tags like #Toolwiki`;
  }

  const hashtagRule = isComparison
    ? `- #AITools, #AIComparison, #AIForBusiness + 3-4 niche tags based on tool category
- Total: exactly 7 tags`
    : `- #AITools, #AIForBusiness, #Productivity + 3-4 niche tags based on tool category
- Total: exactly 7 tags`;

  return `
CAPTION (English output):
- Line 1: strongest insight from the article — keyword-rich (Instagram indexes this line for search)
- Lines 2-3: 2-3 sentences of genuine finding. Real insight, not marketing speak.
${isComparison ? "- Name a clear use-case winner — not just 'it depends'" : "- Name the #1 concrete benefit and the #1 concrete limitation of the tool"}
- CTA: "Save this post" or "Tag someone who uses [X]" — NO comment-baiting ("Write in the comments")
- Last line: → ${domain}/${ctx.articleSlug}
- Max 280 chars per paragraph, 4 paragraphs max

HASHTAGS (7 tags):
${hashtagRule}
- NO self-promotional tags like #Toolwiki`;
}

export function buildHookPrompt(
  pattern: HookPattern,
  ctx: HookPromptContext,
  previousViolations?: string[],
): { systemPrompt: string; userPrompt: string } {
  const violationNote = previousViolations?.length
    ? `\n\nPREVIOUS ATTEMPT WAS INVALID:\n${previousViolations.map((v) => `- ${v}`).join("\n")}\nPlease strictly follow the CONSTRAINTS.`
    : "";

  return {
    systemPrompt: HOOK_SYSTEM_PROMPTS[pattern] + violationNote,
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
): { systemPrompt: string; userPrompt: string } {
  const violationNote = previousViolations?.length
    ? `\n\nPREVIOUS ATTEMPT WAS INVALID:\n${previousViolations.map((v) => `- ${v}`).join("\n")}\nPlease strictly follow all CONSTRAINTS.`
    : "";

  const systemPrompt =
    HOOK_SYSTEM_PROMPTS[pattern] +
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
- Content type: ${ctx.contentType}
- Target keyword: ${ctx.primaryKeyword}
- Article slug: ${ctx.articleSlug}
- Output locale: ${ctx.locale}

RETURN ONLY JSON: { "leadPhrase": "...", "highlightWord": "...", "trailPhrase": "...", "caption": "...", "hashtags": ["...", ...] }`,
  };
}
