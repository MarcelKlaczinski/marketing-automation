import type { TopicBrief } from "@marketing-auto/db";
import type { TopicScope } from "@marketing-auto/db";

export type ClusterProposalPromptInput = {
  brief: TopicBrief;
  projectName: string;
  topicScope: TopicScope;
  intentTaxonomyDefault: string[] | null;
  existingClusterNames: string[];
};

export function buildClusterProposalPrompt(input: ClusterProposalPromptInput): {
  systemPrompt: string;
  userMessage: string;
} {
  const {
    brief,
    projectName,
    topicScope,
    intentTaxonomyDefault,
    existingClusterNames,
  } = input;

  const defaultIntents =
    intentTaxonomyDefault && intentTaxonomyDefault.length > 0
      ? intentTaxonomyDefault.join(", ")
      : "definition, overview, use_cases, comparison, tutorial, pricing";

  const existingList =
    existingClusterNames.length > 0
      ? existingClusterNames.map((n) => `- ${n}`).join("\n")
      : "(none yet — this will be the first cluster)";

  const trendMetaSummary = (() => {
    const m = brief.trendMetadata as Record<string, unknown> | null;
    if (!m) return "";
    const parts: string[] = [];
    if (m["source"]) parts.push(`source=${m["source"]}`);
    if (m["trendScore"]) parts.push(`score=${m["trendScore"]}`);
    return parts.length > 0 ? parts.join(", ") : "";
  })();

  const systemPrompt = `You are a content strategist building a new topical cluster for ${projectName}.

Your job is to propose a new content cluster that will serve as the foundation for a hub-and-spoke SEO content architecture. The cluster must be distinct from all existing clusters, have strong SEO potential, and align with the project's content strategy.

Project context:
- Languages: ${topicScope.languages.join(", ")}
- Exclusions (do NOT cover these): ${topicScope.exclusions.length > 0 ? topicScope.exclusions.join("; ") : "none"}
- Default intent taxonomy: ${defaultIntents}

Output strict JSON — no prose preamble, no markdown fences.`;

  const userMessage = `A trend brief has been identified that doesn't match any existing cluster. Design a new cluster for it.

## Originating brief
Title: ${brief.topicTitle}
Primary keyword: ${brief.primaryKeyword ?? "(not set)"}
Secondary keywords: ${brief.secondaryKeywords.length > 0 ? brief.secondaryKeywords.join(", ") : "(none)"}
Description: ${brief.suggestedMeta ?? "(none)"}
Source: ${brief.source}${trendMetaSummary ? ` (${trendMetaSummary})` : ""}

## Existing clusters in project (DO NOT duplicate these)
${existingList}

## Your task
Propose a new cluster that this brief would be the first spoke article of.

Output JSON with exactly these fields:
{
  "cluster_name": "2-5 word name for the cluster, in the project's primary language (${topicScope.languages[0] ?? "de"})",
  "primary_keyword": "the main SEO target keyword for this entire cluster",
  "description": "1-2 sentence cluster summary (max 500 chars)",
  "intent_taxonomy_override": ["array", "of", "intent", "types"] or null to use project default,
  "pillar_title": "headline for the pillar (cornerstone) article — evergreen, not news-y",
  "pillar_slug": "url-safe lowercase slug for the pillar article (hyphens only)",
  "pillar_meta": "meta description for the pillar article (50-160 chars)",
  "pillar_outline": ["5-10 H2-level section titles for the pillar article"],
  "spoke_intent_for_originating_brief": "which intent type this originating brief should be filed as (must be in intent_taxonomy_override if set, or the project default)",
  "reasoning": "brief paragraph explaining the cluster strategy and why this shape fits the project"
}

Constraints:
- cluster_name must be distinct from all existing clusters listed above
- pillar_slug must match ^[a-z0-9-]+$
- pillar_meta must be 50-160 chars
- pillar_outline must have 5-10 items
- intent_taxonomy_override: choose intents that make topical sense (e.g. a tool cluster → ["definition", "use_cases", "comparison", "tutorial", "pricing"])
- spoke_intent must be from intent_taxonomy_override (if set) or from the default taxonomy
- Output language for cluster_name, pillar_title, pillar_meta, pillar_outline: ${topicScope.languages[0] ?? "de"}
- reasoning must be in English`;

  return { systemPrompt, userMessage };
}
