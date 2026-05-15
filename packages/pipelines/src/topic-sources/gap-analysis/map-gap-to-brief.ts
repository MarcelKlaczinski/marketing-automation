import type { ContentGap, GapMetadata, TopicBriefInsert } from "@marketing-auto/db";

/**
 * Pure mapper: ContentGap row → TopicBriefInsert.
 * No DB calls, no LLM, no side effects. Safe to unit-test in isolation.
 */
export function mapGapToBrief(gap: ContentGap): TopicBriefInsert {
  const meta = gap.metadata;

  const gapMetadata: GapMetadata = {
    gapType:                     gap.gapType,
    priority:                    gap.priority,
    clusterName:                 meta?.clusterName,
    clusterMemberCount:          meta?.clusterMemberCount,
    existingLocale:              meta?.existingLocale,
    existingArticleSlug:         meta?.existingArticleSlug,
    spokesPresent:               meta?.spokesPresent,
    translationKey:              gap.translationKey ?? undefined,
    suggestedCornerstoneKeyword: meta?.suggestedCornerstoneKeyword,
    discoveredKeywords:          meta?.discoveredKeywords,
  };

  return {
    projectId:        gap.projectId,
    source:           "gap_analysis",
    gapId:            gap.id,

    topicTitle:        buildTopicTitle(gap, gapMetadata),
    primaryKeyword:    gapMetadata.suggestedCornerstoneKeyword ?? null,
    secondaryKeywords: gapMetadata.discoveredKeywords ?? [],
    // locale column is text (not narrowed to "de"|"en" at DB level)
    locale:            (gap.locale as "de" | "en" | null) ?? null,
    intentType:        gap.intentType ?? null,

    clusterId:     gap.clusterId ?? null,
    clusterAction: inferClusterAction(gap),
    generationMode: inferGenerationMode(gap),

    approvalRequired: true,
    approvalStatus:   "pending",

    gapMetadata,
  };
}

function inferClusterAction(gap: ContentGap): TopicBriefInsert["clusterAction"] {
  switch (gap.gapType) {
    case "missing_translation": return "translation";
    default:                    return "append_to_existing";
  }
}

function inferGenerationMode(gap: ContentGap): TopicBriefInsert["generationMode"] {
  if (gap.gapType === "missing_hub")         return "pillar";
  if (gap.gapType === "missing_translation") return "translation";
  return "spoke";
}

function buildTopicTitle(gap: ContentGap, meta: GapMetadata): string {
  const cluster = meta.clusterName ?? "unknown cluster";
  switch (gap.gapType) {
    case "missing_hub":
      return `Pillar article for cluster "${cluster}"`;
    case "missing_spoke_type":
      return `${gap.intentType ?? "spoke"} article for cluster "${cluster}"`;
    case "missing_translation":
      return `Translate "${meta.existingArticleSlug ?? "article"}" to ${gap.locale ?? "unknown locale"}`;
    case "cluster_too_small":
      return `Additional spoke for cluster "${cluster}"`;
    default:
      return `Topic for cluster "${cluster}"`;
  }
}
