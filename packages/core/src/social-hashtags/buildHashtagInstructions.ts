export type ContentType = "comparison" | "review" | "general";

export type HashtagContext = {
  locale: string;        // BCP47 primary locale, e.g. "de-DE" | "en-US"
  contentType: ContentType;
  toolNames: string[];   // e.g. ["Cursor", "Windsurf", "Codeium"]
  toolCategory?: string; // e.g. "code-editors" — used to derive niche tags
};

/**
 * Builds the HASHTAGS section of an LLM prompt.
 * Single source of truth for hashtag rules across the social-image pipeline
 * and the discovery worker.
 */
export function buildHashtagInstructions(ctx: HashtagContext): string {
  const isGermanPrimary = ctx.locale.startsWith("de");

  const [anchorDE, anchorEN] = ctx.contentType === "comparison"
    ? [["#KITools", "#KIVergleich"], ["#AITools", "#AIComparison"]]
    : [["#KITools", "#KIFürBusiness"], ["#AITools", "#AIForBusiness"]];

  const toolNameHint = ctx.toolNames.slice(0, 3).join(", ");

  if (isGermanPrimary) {
    const nicheHintDE = ctx.toolCategory
      ? `#${pascalCase(ctx.toolCategory)}`
      : "#SoftwareTest, #Produktivität";

    return `HASHTAGS (exactly 7 tags, bilingual DE+EN mix for dual search intent on Instagram):
- German anchor tags: ${anchorDE.join(", ")}
- English anchor tags: ${anchorEN.join(", ")}
- Plus 1 niche German tag matching tool category (e.g. ${nicheHintDE})
- Plus 1 niche English tag matching tool category
- Plus 1 tool-name tag if a tool name reads naturally as a hashtag: ${toolNameHint}
- Total: EXACTLY 7 tags

RULES:
- NO hyphens in hashtags (Instagram does not parse #KI-Tools as a single tag — write #KITools)
- NO year tags (#KI2026, #2026Tech, #AI2026 — these age out within months)
- NO self-promotional tags (#Toolwiki, #ToolwikiAI, #ToolwikiBlog)
- NO redundant variants of the same concept (avoid #DeveloperTools AND #DevTools AND #CodingTools in the same post)
- Mix German and English freely — German users searching in either language should find the post`;
  }

  // Non-DE locale (e.g. en-US): English-only hashtags
  const nicheHintEN = ctx.toolCategory
    ? `#${pascalCase(ctx.toolCategory)}`
    : "#SoftwareReview, #Productivity";

  return `HASHTAGS (exactly 7 tags, English-only for international reach on Instagram):
- English anchor tags: ${anchorEN.join(", ")}
- Plus 2 niche English tags matching tool category (e.g. ${nicheHintEN})
- Plus 1 tool-name tag if a tool name reads naturally as a hashtag: ${toolNameHint}
- Plus remaining tags: broad English tech tags (e.g. #TechTools, #AIProductivity, #WorkSmarter)
- Total: EXACTLY 7 tags

RULES:
- English only — NO German hashtags (#KITools, #KIVergleich, #Produktivität, etc.)
- NO hyphens in hashtags (write #AITools not #AI-Tools)
- NO year tags (#AI2026, #Tech2026 — these age out within months)
- NO self-promotional tags (#Toolwiki, #ToolwikiAI, #ToolwikiBlog)
- NO redundant variants of the same concept (avoid #DeveloperTools AND #DevTools AND #CodingTools in the same post)`;
}

/**
 * Maps article intentType strings to the simplified 3-way ContentType
 * used by buildHashtagInstructions.
 */
export function deriveContentType(intentType: string | null | undefined): ContentType {
  if (!intentType) return "general";
  const lower = intentType.toLowerCase();
  if (lower.includes("compar") || lower.includes("vergleich") || lower.includes("vs")) return "comparison";
  if (lower.includes("review") || lower.includes("bewertung") || lower.includes("test")) return "review";
  return "general";
}

function pascalCase(input: string): string {
  return input.split(/[-_\s]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}
