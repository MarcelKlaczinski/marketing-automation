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

  const nicheHint = ctx.toolCategory
    ? `#${pascalCase(ctx.toolCategory)}`
    : isGermanPrimary
    ? "#SoftwareTest, #Produktivität"
    : "#SoftwareReview, #Productivity";

  const toolNameHint = ctx.toolNames.slice(0, 3).join(", ");

  return `HASHTAGS (exactly 7 tags, bilingual mix for dual search intent on Instagram):
- German anchor tags: ${anchorDE.join(", ")}
- English anchor tags: ${anchorEN.join(", ")}
- Plus 1 niche German tag matching tool category (e.g. ${nicheHint})
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
