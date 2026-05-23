import type { ArticleCollectionType } from "@marketing-auto/shared";
import type { TenantPromptVars } from "../../_lib/tenant-prompt-vars.ts";
import { buildComparisonDraftPrompt } from "./comparison.ts";
import { buildKiWissenDraftPrompt } from "./ki-wissen.ts";

// Re-export the comparison context-fragment builder so DraftStep can keep its
// existing single-import call site.
export { buildComparisonContextFragment } from "./comparison.ts";

export type DraftPromptFn = (opts: {
  authorInstruction: string;
  today: string;
  locale: "de" | "en";
  /** Spec multi-domain-evolution S4.4 — tenant-resolved domain + niche labels. */
  tenantVars: TenantPromptVars;
}) => string;

/**
 * Returns the draft step-instructions function for a given collection type.
 * `null` = use the built-in blog default (no override).
 *
 * Pattern 109: collection-specific prompts are selected here, never branched
 * inside the step body. Adding a new collection = add one case here.
 */
export function selectDraftPrompt(
  collectionType: ArticleCollectionType | undefined,
): DraftPromptFn | null {
  switch (collectionType) {
    case "comparison":
      return buildComparisonDraftPrompt;
    case "ki-wissen":
      return buildKiWissenDraftPrompt;
    default:
      return null;
  }
}
