import type { TopicBrief } from "@marketing-auto/db";
import type { RoutingDecision } from "./types.ts";

/**
 * Decides what to do with a TopicBrief. Pure function — no DB, no I/O.
 *
 * The decision is structural: derived entirely from brief fields. The caller
 * (executeDecision) performs the actual DB writes inside a transaction.
 *
 * For 54.3, only source='gap_analysis' briefs produce meaningful decisions.
 * Other sources return { kind: 'skip', reason: '...' } so upstream callers
 * see explicit non-handling rather than silent failures.
 */
export function decideRoute(brief: TopicBrief): RoutingDecision {
  if (brief.source !== "gap_analysis") {
    return {
      kind: "skip",
      reason: `Source '${brief.source}' not yet supported in 54.3`,
    };
  }

  const meta = brief.gapMetadata;
  if (!meta) {
    return { kind: "skip", reason: "gap_analysis brief missing gap_metadata" };
  }

  switch (meta.gapType) {
    case "missing_hub": {
      if (!brief.clusterId) {
        return { kind: "skip", reason: "missing_hub requires clusterId" };
      }
      return {
        kind: "create_cornerstone_spec",
        clusterId: brief.clusterId,
        mode: "pillar",
      };
    }

    case "missing_spoke_type":
    case "cluster_too_small": {
      if (!brief.clusterId) {
        return { kind: "skip", reason: `${meta.gapType} requires clusterId` };
      }
      const intentType =
        brief.intentType ??
        (meta.gapType === "missing_spoke_type" ? null : "use_case");
      if (!intentType) {
        return { kind: "skip", reason: "missing_spoke_type requires intentType" };
      }
      return {
        kind: "create_article",
        clusterId: brief.clusterId,
        intentType,
        mode: brief.generationMode ?? "spoke",
      };
    }

    case "missing_translation": {
      const translationKey = meta.translationKey;
      const targetLocale = brief.locale as "de" | "en" | null | undefined;
      if (!translationKey || !targetLocale) {
        return {
          kind: "skip",
          reason: "missing_translation requires translationKey and locale",
        };
      }
      return {
        kind: "create_translation",
        sourceTranslationKey: translationKey,
        targetLocale,
        clusterId: brief.clusterId ?? null,
      };
    }

    default:
      return {
        kind: "skip",
        reason: `Unknown gapType: ${(meta as { gapType: string }).gapType}`,
      };
  }
}
