/**
 * Shared canonical-URL builder for article schema.org JSON-LD.
 *
 * Spec 64.3 — single source of truth between:
 *   • assembly.ts        (DE hot path)
 *   • translation bridge (EN cold path)
 *
 * Mirrors Astro routing convention:
 *   https://{domain}/{locale}/{collection-astro-folder}/{slug}
 *
 * Callers may pass either the narrow `ArticleCollectionType` enum value
 * (e.g. `"comparison"`) or the wider `articles.collection` text-column value
 * (e.g. `"comparisons"`, the Astro folder name). The map below normalises
 * the narrow form; unknown values fall through as-is.
 */

import type { Locale } from "../translation/lib/locale-strings.ts";

// Pattern 107 — third parallel copy of the narrow→Astro-folder map kept in
// sync with packages/pipelines/src/article/blog/persist.ts:18 and
// packages/pipelines/src/article/steps/persist-article.ts:10. Inlined here
// (rather than imported) so packages/pipelines/src/article/lib/ stays a leaf
// with no dependency on any step file.
const COLLECTION_ASTRO_NAME: Record<string, string> = {
  blog: "blog",
  comparison: "comparisons",
  "ki-wissen": "ki-wissen",
  tools: "tools",
  usecases: "usecases",
};

export interface CanonicalUrlInput {
  projectDomain: string;
  locale: Locale;
  collection: string;
  slug: string;
}

export function buildCanonicalUrl(input: CanonicalUrlInput): string {
  const collectionPath = COLLECTION_ASTRO_NAME[input.collection] ?? input.collection;
  return `https://${input.projectDomain}/${input.locale}/${collectionPath}/${input.slug}`;
}
