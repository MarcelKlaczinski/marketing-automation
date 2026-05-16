import type { ClusterPlanInput } from "./types.ts";

export function buildClusterPlanPrompt(
  input: ClusterPlanInput,
  opts?: { refinementHint?: string },
): {
  systemPrompt: string;
  userMessage: string;
} {
  const { triggerBrief, projectName, projectMarketingContextMd, existingPillars, existingClusters } =
    input;

  const pillarList =
    existingPillars.length > 0
      ? existingPillars
          .map((p) => `- id="${p.id}" name="${p.name}"`)
          .join("\n")
      : "(none yet — this will be the first pillar)";

  const clusterList =
    existingClusters.length > 0
      ? existingClusters.map((c) => `- ${c.name}`).join("\n")
      : "(none yet)";

  const trendSummary = (() => {
    const m = triggerBrief.trendMetadata as Record<string, unknown> | null;
    if (!m) return "";
    const parts: string[] = [];
    const score = m["trendScore"];
    const freshness = m["freshnessWindow"];
    const event = m["relatedEvent"];
    if (typeof score === "number") parts.push(`trend_score=${score.toFixed(1)}`);
    if (typeof freshness === "string") parts.push(`freshness=${freshness}`);
    if (typeof event === "string" && event) parts.push(`related_event="${event}"`);
    return parts.length > 0 ? ` (${parts.join(", ")})` : "";
  })();

  const contextSection = projectMarketingContextMd
    ? `## Project marketing context\n${projectMarketingContextMd.slice(0, 1500)}\n`
    : "";

  const systemPrompt = `You are a senior SEO content strategist building a hub-and-spoke content cluster for ${projectName}.

Your task is to expand a trend topic brief into a complete, structured content cluster plan: one cornerstone Hub article plus 4-6 Spoke articles, each targeting a distinct search intent.

${contextSection}
## Existing pillars (assign or create new)
${pillarList}

## Existing clusters (DO NOT duplicate)
${clusterList}

Rules:
- Hub intent must be "overview" or "general" (cornerstone article)
- Spoke intents must be distinct and chosen from: review, comparison, pricing, tutorial, use-cases, features
- Pick intents that make SEO sense for this specific topic — skip what does not fit
- Spoke count: minimum 4, maximum 6 (narrow topics → 4, broad topics → 6)
- All titles must be in German (locale=de)
- Hub title style: cornerstone ("Was ist X 2026: Der vollständige Leitfaden")
- Spoke title style: intent-specific ("X vs Y im Praxistest", "X Pricing Vergleich 2026")
- pillarId must be one of the existing pillar UUIDs above, or the literal string "new"
- If pillarId is "new", set pillarSuggestedName to a short German pillar name
- Output strict JSON only — no preamble, no markdown fences`;

  const userMessage = `## Trend brief to expand
Topic: ${triggerBrief.topicTitle}${trendSummary}
Primary keyword: ${triggerBrief.primaryKeyword ?? "(not set)"}
Secondary keywords: ${
    triggerBrief.secondaryKeywords.length > 0
      ? triggerBrief.secondaryKeywords.join(", ")
      : "(none)"
  }
Intent type hint: ${triggerBrief.intentType ?? "(not set)"}
Brief meta: ${triggerBrief.suggestedMeta ?? "(none)"}

## Task: produce the cluster plan

Output JSON with exactly this structure:
{
  "pillarId": "<existing-pillar-uuid> or 'new'",
  "pillarSuggestedName": "<German pillar name if pillarId='new', else null>",
  "cluster": {
    "name": "<2-5 word German cluster name>",
    "primaryKeyword": "<main SEO keyword for this cluster>"
  },
  "hub": {
    "title": "<German hub article title (cornerstone style)>",
    "primaryKeyword": "<hub's target keyword>",
    "intentType": "overview" | "general",
    "estimatedWordCount": <integer 1200-3000>,
    "h2Outline": ["<H2 section 1>", "<H2 section 2>", ...],
    "metaDescription": "<German meta description, max 160 chars>"
  },
  "spokes": [
    {
      "proposedTitle": "<German spoke title (intent-specific style)>",
      "primaryKeyword": "<spoke's target keyword>",
      "intentType": "review" | "comparison" | "pricing" | "tutorial" | "use-cases" | "features",
      "estimatedWordCount": <integer 800-2500>,
      "rationale": "<English explanation of why this intent makes sense for this topic>",
      "position": <0-based integer>
    }
    // ... 3-5 more spokes
  ]
}

Constraints:
- spokes array: minimum 4 items, maximum 6 items
- Each spoke must have a DISTINCT intentType from other spokes
- h2Outline must have 4-10 items
- rationale must be in English
- All other text fields in German${
    opts?.refinementHint
      ? `\n\n## Refinement instructions\n${opts.refinementHint}`
      : ""
  }`;

  return { systemPrompt, userMessage };
}
