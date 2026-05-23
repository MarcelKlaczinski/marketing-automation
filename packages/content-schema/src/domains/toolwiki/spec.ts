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
import { ComparisonExtrasSchema } from "./extras-comparison.ts";
import { KiWissenExtrasSchema } from "./extras-ki-wissen.ts";
import { ToolsExtrasSchema } from "./extras-tools.ts";
import { UsecasesExtrasSchema } from "./extras-usecases.ts";

export const toolwikiDomain: DomainSpec = {
  niche: "ai-tool-wiki",
  domain: "toolwiki.ai",
  locales: ["de", "en"] as const,
  collections: [
    { name: "blog", extrasSchema: BlogExtrasSchema },
    { name: "comparison", extrasSchema: ComparisonExtrasSchema },
    { name: "ki-wissen", extrasSchema: KiWissenExtrasSchema },
    { name: "tools", extrasSchema: ToolsExtrasSchema },
    { name: "usecases", extrasSchema: UsecasesExtrasSchema },
  ],
  intentTaxonomy: TOOLWIKI_BLOG_INTENT_TYPES,
};
