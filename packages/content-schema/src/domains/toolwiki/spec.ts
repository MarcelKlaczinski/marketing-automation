/**
 * Spec multi-domain-evolution S5.2 — Toolwiki DomainSpec.
 *
 * Registers the 5 Toolwiki collections (blog/comparison/ki-wissen/tools/
 * usecases) with their Bucket-C extras schemas + the canonical intent
 * taxonomy + the bilingual de/en locale set. The exported `toolwikiDomain`
 * value is consumed by `createDbBackedRegistry` at worker boot.
 *
 * Future tenants (e.g. balkon-kraft-werk.de) copy this file shape under
 * `../<niche>/spec.ts` with their own extras + intent set; the registry
 * picks the right spec keyed by `projects.targetNiche`.
 */
import type { DomainSpec } from "../../registry/domain-registry.ts";
import { TOOLWIKI_BLOG_INTENT_TYPES } from "./extras-blog.ts";
import { BlogExtrasSchema } from "./extras-blog.ts";
import { ComparisonExtrasSchema, validateComparisonExtras } from "./extras-comparison.ts";
import { KiWissenExtrasSchema, validateKiWissenExtras } from "./extras-ki-wissen.ts";
import { ToolsExtrasSchema } from "./extras-tools.ts";
import { UsecasesExtrasSchema } from "./extras-usecases.ts";

export const toolwikiDomain: DomainSpec = {
  niche: "ai-tool-wiki",
  domain: "toolwiki.ai",
  locales: ["de", "en"] as const,
  collections: [
    { name: "blog", extrasSchema: BlogExtrasSchema },
    // Spec multi-domain-evolution Domain-Registry follow-up — comparison +
    // ki-wissen register their `validateExtras` callback so the registry-
    // routed DraftStep gate fires the cross-field rules (winner=depends ⇒
    // useCaseVerdicts non-empty for comparison; category/level/icon/facts/
    // next enums + Pattern 116 monetization rejection for ki-wissen). Without
    // the callback, swapping the legacy direct import for the registry path
    // would silently drop the cross-field rules and break byte-equivalence
    // on Toolwiki articles.
    {
      name: "comparison",
      extrasSchema: ComparisonExtrasSchema,
      validateExtras: validateComparisonExtras,
    },
    {
      name: "ki-wissen",
      extrasSchema: KiWissenExtrasSchema,
      validateExtras: validateKiWissenExtras,
    },
    { name: "tools", extrasSchema: ToolsExtrasSchema },
    { name: "usecases", extrasSchema: UsecasesExtrasSchema },
  ],
  intentTaxonomy: TOOLWIKI_BLOG_INTENT_TYPES,
  // Spec multi-domain-evolution Phase-C — moved out of the hardcoded switch
  // in apps/api/src/routes/projects/briefs.ts `deriveIntentFromCollection()`.
  // Matches the legacy 4-value mapping exactly so Toolwiki brief-creation
  // stays byte-equivalent. Includes `cluster` (planner pseudo-collection per
  // Spec 62.4) because the manual-brief form accepts it as a collectionHint.
  // Future tenants (BK etc.) override this map in their own DomainSpec.
  collectionToIntentMap: {
    comparison: "comparison",
    "ki-wissen": "knowledge",
    blog: "use_case",
    cluster: "use_case",
  },
};
