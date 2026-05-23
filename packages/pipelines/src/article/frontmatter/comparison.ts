/**
 * Back-compat re-export. Canonical home since Spec multi-domain-evolution
 * S2.4 is `@marketing-auto/content-schema/domains/toolwiki`. Consumers can
 * migrate at their own pace; this re-export is droppable post-BK-launch.
 */
export {
  ComparisonWinnerSchema,
  type ComparisonWinner,
  UseCaseVerdictSchema,
  type UseCaseVerdict,
  ComparisonExtrasSchema,
  type ComparisonExtras,
  comparisonFrontmatterBounds,
  validateComparisonExtras,
} from "@marketing-auto/content-schema/domains/toolwiki";
