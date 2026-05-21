// Spec 63.2 — collection-level allow-list for the social-post source pool.
//
// Social-post selectors must only return articles from collections that have
// at least one rendering template. Otherwise the planner emits items that die
// at generation time on the per-article eligibility check (template registry),
// inflating plan cost and producing phantom shortfall.
//
// Current templates (Stand 2026-05):
//   - tools       → single-tool-spotlight, pro-con-verdict
//   - comparisons → comparison-grid-4, comparison-grid-3, verdict-per-use-case
//
// When Phase-E templates land (workflow-impact-stack, definition-card, …),
// extend this list with the additional collections (ki-wissen, usecases, …).
//
// Why a hand-curated constant and not derived from templateRegistry: registry
// eligibility is per-article (tool count, pro/con count, etc.). The pool
// filter only needs collection-level coverage. Constant is cheaper, easier to
// audit, and forces a deliberate update when a new template lands.
export const SOCIAL_ELIGIBLE_COLLECTIONS = ["tools", "comparisons"] as const;

export type SocialEligibleCollection = (typeof SOCIAL_ELIGIBLE_COLLECTIONS)[number];
