/**
 * Canonical article collection enum. Pre-Spec multi-domain-evolution S2.3
 * this lived in `@marketing-auto/shared/types/article-collection`; the new
 * home in `@marketing-auto/content-schema/enums` keeps all article-routing
 * taxonomy in one package.
 *
 * `@marketing-auto/shared` continues to re-export `ARTICLE_COLLECTION_TYPES`
 * + `ArticleCollectionType` + `isArticleCollectionType` for back-compat
 * during the migration window. Consumers will be migrated to import from
 * here directly in later sprints; the back-compat re-export will be
 * dropped after the BK launch (per spec §10 Q3 default — additive
 * migration, no production downtime).
 *
 * Adding a new collection: extend the `as const` tuple here AND add a
 * matching entry to [`./routing.ts`](./routing.ts) `COLLECTION_ASTRO_NAME`.
 * TypeScript's `Record<ArticleCollectionType, string>` will catch a missing
 * routing entry at compile time. Per-tenant collection sets (Sprint 4+
 * Domain-Registry) layer on top of this canonical set; the Toolwiki tenant
 * uses the full set, BK will subset.
 */

export const ARTICLE_COLLECTION_TYPES = [
  "blog",
  "comparison",
  "ki-wissen",
  "tools",
  "usecases",
] as const;

export type ArticleCollectionType = (typeof ARTICLE_COLLECTION_TYPES)[number];

export function isArticleCollectionType(v: unknown): v is ArticleCollectionType {
  return ARTICLE_COLLECTION_TYPES.includes(v as ArticleCollectionType);
}
