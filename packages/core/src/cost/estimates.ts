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
  },
  replicate: {
    [COST_OPS.HERO_IMAGE]: 0.1,
  },
  dataforseo: {
    [COST_OPS.DATAFORSEO_SERP_ANALYSIS]: 0.2,
    [COST_OPS.DATAFORSEO_KEYWORD_RESEARCH]: 0.05,
    [COST_OPS.DATAFORSEO_BACKLINK_CHECK]: 0.3,
  },
  smtp: {
    [COST_OPS.SMTP_MAGIC_LINK]: 0.001,
    [COST_OPS.SMTP_BRIEFING]: 0.001,
  },
  // PSI API is free (25k requests/day with key, 400/day without)
  pagespeed: {
    [COST_OPS.PAGESPEED_PSI_API]: 0,
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
