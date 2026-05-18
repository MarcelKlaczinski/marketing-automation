/**
 * Single source of truth for cost operation identifiers.
 *
 * Use these constants in:
 *   - Pipeline step adapter calls (operation: COST_OPS.X)
 *   - Trigger-helper costEstimate (operation: COST_OPS.X)
 *
 * Adding a new operation:
 *   1. Add a constant here
 *   2. Add an estimate to COST_ESTIMATES_EUR in estimates.ts
 *   3. Use the constant — never hard-code the string
 */

export const COST_OPS = {
  // === Article generation pipeline ===
  ARTICLE_OUTLINE: "article-outline",
  ARTICLE_DRAFT: "article-draft",
  ARTICLE_SELF_REVIEW: "article-self-review",
  ARTICLE_RESEARCH_SERP: "article-research-serp",
  ARTICLE_RESEARCH_SYNTHESIS: "research-competitor-synthesis",

  // === Cold-start phase 1: Voice ===
  COLD_START_VOICE_QUESTIONS: "voice-questions-generation",
  COLD_START_VOICE_SYNTHESIS: "voice-synthesis",

  // === Cold-start phase 2: Competitor analysis ===
  COLD_START_COMPETITOR_IDENTIFICATION: "competitor-identification",
  COLD_START_COMPETITOR_ANALYSIS: "competitor-report-synthesis",

  // === Cold-start phase 3: Cluster plan ===
  COLD_START_CLUSTER_CANDIDATES: "cluster-candidates-generation",
  COLD_START_CLUSTER_KEYWORD_OVERVIEW: "cluster-keyword-overview",
  COLD_START_CLUSTER_SYNTHESIS: "cluster-plan-synthesis",

  // === Cold-start phase 4: Cornerstone ===
  COLD_START_CORNERSTONE_SPECS: "cornerstone-specs-generation",

  // === Cold-start phase 5: Go-live ===
  COLD_START_GO_LIVE_CHECKLIST: "cold-start-go-live-checklist",

  // === Schema extension ===
  SCHEMA_RICH_DETECTION: "schema-rich-detection",
  SCHEMA_FAQ_BUILD: "schema-faq-build",
  SCHEMA_HOWTO_BUILD: "schema-howto-build",

  // === Internal linking (Spec 24) ===
  INTERNAL_LINK_ANALYSIS: "internal-link-analysis",
  INTERNAL_LINK_REBUILD: "internal-link-rebuild",

  // === Hero image (Replicate) ===
  HERO_IMAGE: "hero-image-generation",

  // === DataForSEO ===
  DATAFORSEO_SERP_ANALYSIS: "serp-analysis",
  DATAFORSEO_KEYWORD_RESEARCH: "keyword-research",
  DATAFORSEO_BACKLINK_CHECK: "backlink-check",

  // === Briefing ===
  BRIEFING_GENERATION: "briefing-generation",

  // === SMTP ===
  SMTP_MAGIC_LINK: "magic-link-email",
  SMTP_BRIEFING: "briefing-email",

  // === PageSpeed Insights API ===
  PAGESPEED_PSI_API: "pagespeed-psi-api",

  // === Spec 49c: Gap title suggestion + keyword enrichment ===
  GAP_TITLE_SUGGEST:        "gap-title-suggest",
  GAP_KEYWORD_OVERVIEW:     "gap-keyword-overview",   // keywordOverview() when cluster has Cold-Start data
  GAP_RELATED_KEYWORDS:     "gap-related-keywords",   // relatedKeywords() fallback for Astro-imported clusters

  // === Spec 50: Frontmatter field suggestion (Haiku) ===
  FRONTMATTER_SUGGEST:      "frontmatter-suggest",    // Haiku-powered category/intentType/faq suggestion

  // === Spec 51: Social image generation (Instagram carousel) ===
  SOCIAL_IMAGE_EXTRACT:   "social-image-extract",    // Haiku: extract tools from article
  SOCIAL_IMAGE_CAPTION:   "social-image-caption",    // Sonnet: write Instagram caption + hashtags (merged, Spec 57.4)

  // === Spec 54.5: Trend discovery synthesis ===
  TREND_SYNTHESIS:              "trend-synthesis",              // Opus: daily LLM synthesis of signals into TopicBriefs
  TREND_COVERAGE_TIEBREAKER:    "trend-coverage-tiebreaker",    // Haiku: disambiguate borderline topic similarity
  DATAFORSEO_TRENDS_EXPLORE:    "dataforseo-trends-explore",    // DataForSEO Trends per-keyword growth lookup
  VOYAGE_EMBED_TEXT:            "voyage-embed-text",            // Voyage AI embedding for coverage & cluster match

  // === Spec 54.10: Refresh + Translation modes ===
  TRANSLATION_DECISION:  "translation-decision",   // Haiku: decide literal vs adaptive translation path (~€0.005)
  TRANSLATE_DRAFT:       "translate-draft",         // Sonnet: translate DE body to EN (literal path, ~€0.20)
  REFRESH_OUTLINE:       "refresh-outline",         // Sonnet: re-generate outline with voice refs (~€0.07)
  REFRESH_DRAFT:         "refresh-draft",           // Sonnet: re-generate draft with voice refs (~€0.22)

  // === Spec 54.12: Full Cluster Generation ===
  CLUSTER_PLAN_GENERATION: "cluster-plan-generation", // Sonnet: expand trend brief into Hub + 4-6 Spokes (~€0.40)

  // === Spec E.1a: Article quality analysis ===
  ARTICLE_QUALITY_ANALYSIS: "article-quality-analysis", // Sonnet: standalone content review for refresh suggestions (~€0.03)

  // === Spec 59.1a: Reddit signal source ===
  REDDIT_SIGNAL_COLLECT: "reddit-signal-collect", // free API — tracked for observability only

  // === Spec 59.1b: GitHub trending signal source ===
  GITHUB_SIGNAL_COLLECT: "github-signal-collect", // free API — tracked for observability only
} as const;

export type CostOp = (typeof COST_OPS)[keyof typeof COST_OPS];

/** Runtime set for warn-on-unknown guard in estimateCostEur */
export const VALID_COST_OPS = new Set<string>(Object.values(COST_OPS));
