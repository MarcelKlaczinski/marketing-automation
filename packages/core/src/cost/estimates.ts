import { createLogger } from "@marketing-auto/shared";
import { COST_OPS, VALID_COST_OPS } from "./operations.ts";

const log = createLogger("cost-estimates");

export const COST_ESTIMATES_EUR: Record<string, Record<string, number>> = {
  anthropic: {
    [COST_OPS.ARTICLE_OUTLINE]: 0.3,
    [COST_OPS.ARTICLE_DRAFT]: 1.5,
    [COST_OPS.ARTICLE_SELF_REVIEW]: 0.8,
    [COST_OPS.ARTICLE_RESEARCH_SYNTHESIS]: 0.1,

    [COST_OPS.COLD_START_VOICE_QUESTIONS]: 0.1,
    [COST_OPS.COLD_START_VOICE_SYNTHESIS]: 0.2,

    [COST_OPS.COLD_START_COMPETITOR_IDENTIFICATION]: 0.05,
    [COST_OPS.COLD_START_COMPETITOR_ANALYSIS]: 0.2,

    [COST_OPS.COLD_START_CLUSTER_CANDIDATES]: 0.2,
    [COST_OPS.COLD_START_CLUSTER_KEYWORD_OVERVIEW]: 0.15,
    [COST_OPS.COLD_START_CLUSTER_SYNTHESIS]: 0.3,

    [COST_OPS.COLD_START_CORNERSTONE_SPECS]: 0.4,
    [COST_OPS.COLD_START_GO_LIVE_CHECKLIST]: 0.1,

    [COST_OPS.SCHEMA_RICH_DETECTION]: 0.1,
    [COST_OPS.SCHEMA_FAQ_BUILD]: 0.1,
    [COST_OPS.SCHEMA_HOWTO_BUILD]: 0.1,

    [COST_OPS.INTERNAL_LINK_ANALYSIS]: 0.3,
    [COST_OPS.INTERNAL_LINK_REBUILD]: 0.2,

    [COST_OPS.BRIEFING_GENERATION]: 0.1,

    // Spec 49c: gap title suggestion (Claude Haiku, ~1000 tokens total)
    [COST_OPS.GAP_TITLE_SUGGEST]: 0.01,

    // Spec 50: frontmatter field suggestion (Claude Haiku, ~1500 tokens total)
    [COST_OPS.FRONTMATTER_SUGGEST]: 0.02,

    // Spec 54.5: trend discovery synthesis
    [COST_OPS.TREND_SYNTHESIS]:           0.40,  // Opus 4.7, ~5k input + 3k output tokens per project
    [COST_OPS.TREND_COVERAGE_TIEBREAKER]: 0.005, // Haiku, ~800 tokens per borderline candidate

    // Spec 54.10: refresh + translation modes (validated against real 54.9 cost data)
    [COST_OPS.TRANSLATION_DECISION]: 0.005,  // Haiku 4.5, ~1k tokens — literal vs adaptive decision
    [COST_OPS.TRANSLATE_DRAFT]:      0.20,   // Sonnet 4.6, ~4k input + 4k output — literal translation
    [COST_OPS.REFRESH_OUTLINE]:      0.07,   // Sonnet 4.6 + voice ref context (~2k extra input)
    [COST_OPS.REFRESH_DRAFT]:        0.22,   // Sonnet 4.6 + voice ref context (~2k extra input)

    // Spec 54.12: cluster plan generation
    [COST_OPS.CLUSTER_PLAN_GENERATION]: 0.40, // Sonnet 4.6, ~4k input + 3k output (hub + 4-6 spokes)

    // Spec E.1a: article quality analysis (standalone refresh detection)
    [COST_OPS.ARTICLE_QUALITY_ANALYSIS]: 0.03, // Sonnet 4.6, ~8k input + 2k output per article

    // Spec 51/57.4: Social image pipeline (Anthropic calls)
    [COST_OPS.SOCIAL_IMAGE_EXTRACT]:  0.005, // Haiku: extract tool list from article body
    [COST_OPS.SOCIAL_IMAGE_CAPTION]:  0.028, // Sonnet: caption + hashtags (merged, Spec 57.4)
  },
  dataforseo: {
    [COST_OPS.DATAFORSEO_SERP_ANALYSIS]: 0.2,
    [COST_OPS.DATAFORSEO_KEYWORD_RESEARCH]: 0.05,
    [COST_OPS.DATAFORSEO_BACKLINK_CHECK]: 0.3,
    // Spec 49c: small per-gap keyword overview (5-15 keywords, actual cost ~€0.002)
    [COST_OPS.GAP_KEYWORD_OVERVIEW]:  0.01,
    // Spec 49c: relatedKeywords fallback for Astro-imported clusters (no Cold-Start data)
    [COST_OPS.GAP_RELATED_KEYWORDS]:  0.015,

    // Spec 54.5: trend discovery DataForSEO growth lookup per keyword
    [COST_OPS.DATAFORSEO_TRENDS_EXPLORE]: 0.010,
  },
  voyage: {
    // Spec 54.5: Voyage AI embeddings for coverage check & cluster match (voyage-3-large)
    [COST_OPS.VOYAGE_EMBED_TEXT]: 0.0001,
  },
  replicate: {
    [COST_OPS.HERO_IMAGE]: 0.1,
  },
  smtp: {
    [COST_OPS.SMTP_MAGIC_LINK]: 0.001,
    [COST_OPS.SMTP_BRIEFING]: 0.001,
  },
  // PSI API is free (25k requests/day with key, 400/day without)
  pagespeed: {
    [COST_OPS.PAGESPEED_PSI_API]: 0,
  },
  // Reddit OAuth API is free — tracked for observability only
  reddit: {
    [COST_OPS.REDDIT_SIGNAL_COLLECT]: 0,
  },
  // GitHub REST API is free (5000 req/hour with PAT) — tracked for observability only
  github: {
    [COST_OPS.GITHUB_SIGNAL_COLLECT]: 0,
  },
};

export function estimateCostEur(service: string, operation: string, multiplier = 1): number {
  if (!VALID_COST_OPS.has(operation)) {
    log.warn(
      { service, operation },
      "Unknown operation — not in COST_OPS constants. Add to operations.ts + estimates.ts."
    );
  }
  const baseEur = COST_ESTIMATES_EUR[service]?.[operation] ?? 0;
  if (baseEur === 0) {
    log.warn(
      { service, operation },
      "No cost estimate found — cost check will pass with 0 EUR. Add an entry to COST_ESTIMATES_EUR."
    );
  }
  return baseEur * multiplier;
}
