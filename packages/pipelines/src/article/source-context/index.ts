import type { GapMetadata, RefreshMetadata, TrendMetadata, TopicBrief } from "@marketing-auto/db";

/**
 * Build a source-specific context fragment for outline and draft prompts.
 *
 * Injected into the user message so it does NOT break the Anthropic
 * prompt-cache boundary (system prompt stays cacheable). Returns an empty
 * string for "manual" source or any unknown source — no special framing needed.
 *
 * Source mapping:
 *  - gap_analysis      → cluster context, gap type, existing sibling articles
 *  - trend_discovery   → freshness window, trend score, signal sources, related event
 *  - manual            → "" (use brief fields as-is)
 *  - refresh_detection → refresh context with staleness + reason (Spec 54.10)
 */
export function buildSourceContextFragment(brief: TopicBrief): string {
  switch (brief.source) {
    case "gap_analysis":
      return buildGapContextFragment(brief.gapMetadata ?? null);
    case "trend_discovery":
      return buildTrendContextFragment(brief.trendMetadata ?? null);
    case "manual":
      return "";
    case "refresh_detection":
      return buildRefreshContextFragment(brief.refreshMetadata ?? null);
    default:
      return "";
  }
}

function buildGapContextFragment(gap: GapMetadata | null): string {
  if (!gap) return "";

  const lines = [
    "**Cluster Context (Gap Analysis):**",
    `This article fills a content gap of type "${gap.gapType}".`,
  ];

  if (gap.clusterName) {
    lines.push(`Cluster: "${gap.clusterName}".`);
  }

  if (gap.spokesPresent && gap.spokesPresent.length > 0) {
    lines.push(
      `Existing articles in this cluster: ${gap.spokesPresent.join(", ")}.`,
      "The article should complement (not duplicate) these existing pieces.",
    );
  }

  if (gap.suggestedCornerstoneKeyword) {
    lines.push(`Suggested cornerstone keyword: "${gap.suggestedCornerstoneKeyword}".`);
  }

  return lines.join("\n");
}

function buildTrendContextFragment(trend: TrendMetadata | null): string {
  if (!trend) return "";

  const distinctSources = [
    ...new Set(trend.signals.map((s) => s.source)),
  ].join(", ");

  const lines = [
    "**Trend Context:**",
    `This article responds to a current trend (freshness: ${trend.freshnessWindow}).`,
    `Trend score: ${trend.trendScore}/100.`,
    `Detected via: ${distinctSources} (${trend.signals.length} signal${trend.signals.length !== 1 ? "s" : ""}).`,
  ];

  if (trend.relatedEvent) {
    lines.push(`Related event: ${trend.relatedEvent}.`);
  }

  lines.push("Lead with the timely angle. Do not bury the news in evergreen framing.");

  return lines.join("\n");
}

function buildRefreshContextFragment(meta: RefreshMetadata | null): string {
  const daysSince = meta?.staleness.daysSinceLastUpdate ?? null;
  const reason = meta?.reason ?? "general refresh";

  const lines = [
    "**Refresh Context:**",
    `This is a refresh of an existing article${daysSince !== null ? ` (last updated ${daysSince} days ago)` : ""}.`,
    `Refresh reason: ${reason}.`,
    "",
    "You are NOT writing a new article from scratch. The original article body is provided as a voice-style reference.",
    "Goals:",
    "1. Preserve the article's narrative arc and voice",
    "2. Update outdated facts (pricing, tool versions, statistics)",
    "3. Add relevant new information (tools or trends that emerged since the original)",
    "4. Rewrite weak sections, keep strong ones",
  ];

  return lines.join("\n");
}
