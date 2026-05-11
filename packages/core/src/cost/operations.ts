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

  // === Spec 49c: Gap title suggestion ===
  GAP_TITLE_SUGGEST: "gap-title-suggest",
} as const;

export type CostOp = (typeof COST_OPS)[keyof typeof COST_OPS];

/** Runtime set for warn-on-unknown guard in estimateCostEur */
export const VALID_COST_OPS = new Set<string>(Object.values(COST_OPS));
